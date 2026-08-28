import assert from 'node:assert/strict'
import test from 'node:test'
import { M82Assembler, splitBlobs } from '../src/vendors/m82/assemble.ts'

// Block reassembly only became testable once the acknowledgement was solved —
// see docs/m82-protocol.md section 6. Before that the device never advanced
// past block 1, so these fixtures are the first ones synthesised rather than
// captured; a real multi-block push has not yet been observed on hardware.

const lenPrefixed = (json: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(json), 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(body.length, 0)
  return Buffer.concat([len, body])
}

/** One length-prefixed blob, as it appears in the attachment region. */
const blobFrame = (bytes: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32LE(bytes.length, 0)
  return Buffer.concat([len, bytes])
}

test('splitBlobs separates concatenated length-prefixed blobs', () => {
  const a = Buffer.from('first blob')
  const b = Buffer.from('second, longer blob here')
  const region = Buffer.concat([blobFrame(a), blobFrame(b)])

  const blobs = splitBlobs(region)
  assert.equal(blobs.length, 2)
  assert.deepEqual(blobs[0], a)
  assert.deepEqual(blobs[1], b)
})

test('splitBlobs keeps a zero-length slot as an empty buffer, not a skip', () => {
  // A zero-length blob is a reserved credential slot with nothing captured
  // yet. Dropping it instead of keeping it would shift every later blob's
  // position relative to the BIN_N index the JSON refers to.
  const a = Buffer.from('present')
  const region = Buffer.concat([blobFrame(Buffer.alloc(0)), blobFrame(a)])

  const blobs = splitBlobs(region)
  assert.equal(blobs.length, 2)
  assert.equal(blobs[0]!.length, 0)
  assert.deepEqual(blobs[1], a)
})

test('splitBlobs drops a trailing fragment rather than guessing at it', () => {
  const whole = blobFrame(Buffer.from('complete'))
  const truncated = Buffer.concat([whole, Buffer.from([0x05, 0x00, 0x00, 0x00, 0x01, 0x02])])

  const blobs = splitBlobs(truncated)
  assert.equal(blobs.length, 1)
  assert.deepEqual(blobs[0], Buffer.from('complete'))
})

test('a single-block payload with no attachments completes immediately', () => {
  const assembler = new M82Assembler()
  const json = { user_id: '00000002', user_name: 'jamesepale' }
  const body = lenPrefixed(json)

  const result = assembler.add({ serial: 'ENS2025079', requestCode: 'realtime_enroll_data' }, null, body)

  assert.ok(result)
  assert.deepEqual(result!.json, json)
  assert.equal(result!.blobs.length, 0)
  assert.equal(result!.blocks, 1)
  assert.equal(assembler.pendingCount, 0)
})

test('a payload split across two blocks assembles once both arrive', () => {
  const assembler = new M82Assembler()
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0])   // JFIF magic
  const template = Buffer.alloc(200, 0x42)

  const whole = Buffer.concat([
    lenPrefixed({ user_id: '00000002', enroll_data_array: [{ backup_number: 0, enroll_data: 'BIN_1' }] }),
    blobFrame(photo),
    blobFrame(template),
  ])

  const key = { serial: 'ENS2025079', requestCode: 'realtime_enroll_data' }
  const midpoint = Math.floor(whole.length / 2)

  // Block 1 alone is not enough — the second blob is still incomplete.
  const partial = assembler.add(key, 1, whole.subarray(0, midpoint))
  assert.equal(partial, null)
  assert.equal(assembler.pendingCount, 1)

  const complete = assembler.add(key, 2, whole.subarray(midpoint))
  assert.ok(complete)
  assert.equal(complete!.blocks, 2)
  assert.equal(complete!.blobs.length, 2)
  assert.deepEqual(complete!.blobs[0], photo)
  assert.deepEqual(complete!.blobs[1], template)
  assert.equal(assembler.pendingCount, 0, 'completed assembly is cleared, not retained')
})

test('a retransmitted block replaces rather than duplicates', () => {
  // This firmware retries relentlessly. Appending a repeated block instead of
  // replacing it would corrupt the stream on the very first retry.
  const assembler = new M82Assembler()
  const whole = Buffer.concat([lenPrefixed({ user_id: '1' }), blobFrame(Buffer.from('data'))])
  const key = { serial: 'S', requestCode: 'realtime_enroll_data' }
  const midpoint = Math.floor(whole.length / 2)

  assembler.add(key, 1, whole.subarray(0, midpoint))
  assembler.add(key, 1, whole.subarray(0, midpoint))   // retransmit of block 1
  const complete = assembler.add(key, 2, whole.subarray(midpoint))

  assert.ok(complete)
  assert.deepEqual(complete!.blobs[0], Buffer.from('data'))
})

test('two different devices assemble independently', () => {
  const assembler = new M82Assembler()
  const bodyA = lenPrefixed({ user_id: 'a' })
  const bodyB = lenPrefixed({ user_id: 'b' })

  const resultA = assembler.add({ serial: 'DEV-A', requestCode: 'realtime_enroll_data' }, null, bodyA)
  const resultB = assembler.add({ serial: 'DEV-B', requestCode: 'realtime_enroll_data' }, null, bodyB)

  assert.equal(resultA?.json?.user_id, 'a')
  assert.equal(resultB?.json?.user_id, 'b')
})

test('an oversized payload is abandoned rather than buffered without limit', () => {
  const assembler = new M82Assembler()
  const key = { serial: 'S', requestCode: 'realtime_enroll_data' }
  const huge = Buffer.alloc(9 * 1024 * 1024)   // past the 8MB cap

  const result = assembler.add(key, 1, huge)
  assert.equal(result, null)
  assert.equal(assembler.pendingCount, 0, 'an over-cap payload must not be retained either')
})
