import assert from "node:assert/strict";
import {
  deepgramPhonetics,
  speakMathDynamically,
  splitMathIslands,
  texToSpoken,
} from "../src/lib/math/dynamicMathSpeech";

async function main() {
  const frac = await texToSpoken("\\frac{1}{2}");
  assert.ok(frac, "frac should speak");
  assert.match(frac!, /half|1|one/i);
  console.log("frac:", frac);

  const integ = await texToSpoken("\\int_a^b f(x)\\,dx");
  assert.ok(integ && /integral/i.test(integ), "integral should mention integral");
  console.log("integral:", integ);

  const mu = await speakMathDynamically("Permeability of free space is $\\mu_0$.");
  assert.match(mu, /mew/i, "mu should become mew for Deepgram");
  assert.ok(!/\bmu\b/i.test(mu) || /mew/i.test(mu));
  console.log("mu line:", mu);

  const pi = await speakMathDynamically("Area is $\\pi r^2$.");
  assert.match(pi, /pie/i, "pi should become pie for Deepgram");
  console.log("pi line:", pi);

  const deriv = await speakMathDynamically("The derivative d/dx of x^2 is 2x.");
  assert.ok(deriv.length > 10, "derivative line should expand");
  console.log("deriv:", deriv);

  const islands = splitMathIslands("Take $\\frac{1}{2}$ of the charge.");
  assert.ok(islands.some((p) => p.kind === "math"), "should detect $...$ island");

  assert.equal(deepgramPhonetics("mu sub 0 and pi"), "mew naught and pie");

  // Prose-only line still returns text (phonetics only)
  const prose = await speakMathDynamically("The electric field points away from positive charge.");
  assert.match(prose, /electric field/i);

  console.log("dynamic math speech smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
