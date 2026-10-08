// Battle Cats uses a 32-bit xorshift RNG. godfat's tracker lays the seed
// sequence out on two interleaved tracks:
//   seq[0] = seed from the URL, seq[i + 1] = xorshift(seq[i])
//   Track A, position N: rarity = seq[2N - 1], slot = seq[2N]
//   Track B, position N: rarity = seq[2N],     slot = seq[2N + 1]
// (Verified against the "seed=" links godfat renders for every cell.)

function xorshift32(s) {
  s ^= s << 13; s >>>= 0;
  s ^= s >>> 17;
  s ^= s << 15;
  return s >>> 0;
}

function buildSequence(seed, maxN) {
  const seq = new Array(2 * maxN + 4);
  seq[0] = seed >>> 0;
  for (let i = 1; i < seq.length; i++) seq[i] = xorshift32(seq[i - 1]);
  return seq;
}

const raritySeed = (seq, n, track) => (track === 'A' ? seq[2 * n - 1] : seq[2 * n]);
const slotSeed = (seq, n, track) => (track === 'A' ? seq[2 * n] : seq[2 * n + 1]);

export { xorshift32, buildSequence, raritySeed, slotSeed };
