import { decodeFunctionData, recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import {
  announceCalldata,
  eip3009Abi,
  erc5564AnnouncerAbi,
  generateStealthPayment,
  monad,
  openStealthMemo,
  parseStealthMetadata,
  signStealthTransfer,
  stealthKeysFromSignature,
  stealthKeysMessage,
  stealthMetaAddress,
  stealthPrivateKey,
  transferAuthorizationTypedData,
  checkStealthAddress,
  viewKeyOf,
} from '../src/index.js'

describe('the whole round: send, announce, find, open, spend without gas', () => {
  it('works end to end, with the one-time address signing its own transfer', async () => {
    // The receiver makes keys from a wallet signature and shares the meta-address.
    const receiver = privateKeyToAccount(generatePrivateKey())
    const keys = stealthKeysFromSignature(await receiver.signMessage({ message: stealthKeysMessage('MyApp', receiver.address) }))
    const meta = stealthMetaAddress(keys)

    // The sender derives a one-time address and a sealed note, and announces it.
    const token = monad.mainnet.tokens.AUSD
    const pay = generateStealthPayment(meta, { name: 'Ada', note: 'Rent' })
    const announce = decodeFunctionData({ abi: erc5564AnnouncerAbi, data: announceCalldata(pay, token.address, 25_000_000n) })
    const [, stealthAddress, ephemeralPubKey, metadata] = announce.args as [bigint, `0x${string}`, `0x${string}`, `0x${string}`]
    expect(stealthAddress).toBe(pay.stealthAddress)

    // The receiver scans: the view tag and address match, the note opens, the amount reads.
    const parsed = parseStealthMetadata(metadata)
    expect(checkStealthAddress(viewKeyOf(keys), { ephemeralPublicKey: ephemeralPubKey, viewTag: parsed!.viewTag, stealthAddress })).toBe(stealthAddress)
    expect(openStealthMemo(keys.viewingPrivateKey, { ...pay, sealed: parsed!.sealed })).toEqual({ name: 'Ada', note: 'Rent' })
    expect(parsed!.amount).toBe(25_000_000n)

    // The receiver spends: the one-time key signs a transfer a relayer can submit.
    const to = privateKeyToAccount(generatePrivateKey()).address
    const signed = await signStealthTransfer({
      stealthPrivateKey: stealthPrivateKey(keys, ephemeralPubKey),
      token,
      chainId: monad.mainnet.chainId,
      to,
      value: 25_000_000n,
    })
    expect(signed.authorization.from).toBe(stealthAddress)
    const signer = await recoverTypedDataAddress({
      ...transferAuthorizationTypedData(token, monad.mainnet.chainId, signed.authorization),
      signature: signed.signature,
    })
    expect(signer).toBe(stealthAddress)
    const call = decodeFunctionData({ abi: eip3009Abi, data: signed.calldata })
    expect(call.functionName).toBe('transferWithAuthorization')
    expect(call.args?.slice(0, 3)).toEqual([stealthAddress, to, 25_000_000n])
  })
})
