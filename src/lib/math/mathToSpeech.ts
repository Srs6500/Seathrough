/**
 * Turn written math into something a TTS voice can say out loud.
 * Captions and the board stay as written; only speech goes through this.
 */

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "1 over 2",
  "⅓": "1 over 3",
  "⅔": "2 over 3",
  "¼": "1 over 4",
  "¾": "3 over 4",
  "⅕": "1 over 5",
  "⅖": "2 over 5",
  "⅗": "3 over 5",
  "⅘": "4 over 5",
  "⅙": "1 over 6",
  "⅚": "5 over 6",
  "⅛": "1 over 8",
  "⅜": "3 over 8",
  "⅝": "5 over 8",
  "⅞": "7 over 8",
};

const NAMED_POWERS: Record<string, string> = {
  "0": "to the 0",
  "1": "to the 1",
  "2": "squared",
  "3": "cubed",
};

const GREEK: Record<string, string> = {
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  Delta: "delta",
  theta: "theta",
  lambda: "lambda",
  mu: "mu",
  pi: "pi",
  sigma: "sigma",
  Sigma: "sigma",
  phi: "phi",
  omega: "omega",
  Omega: "omega",
};

const SIMPLE_SPOKEN: Record<string, string> = {
  lim: "the limit of",
  int: "the integral of",
  times: "times",
  div: "divided by",
  cdot: "times",
  pm: "plus or minus",
  mp: "minus or plus",
  leq: "less than or equal to",
  geq: "greater than or equal to",
  neq: "is not equal to",
  approx: "approximately",
  infty: "infinity",
  rightarrow: "goes to",
  leftarrow: "comes from",
  Rightarrow: "implies",
  Leftrightarrow: "if and only if",
  to: "goes to",
  ldots: "",
  cdots: "",
  dots: "",
  quad: " ",
  qquad: " ",
  ",": " ",
  ";": " ",
  "!": "",
  " ": " ",
  pi: "pi",
  theta: "theta",
  alpha: "alpha",
  beta: "beta",
};

function unwrapBraced(
  input: string,
  start: number,
): { inner: string; end: number } | null {
  if (input[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { inner: input.slice(start + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function speakPower(exp: string): string {
  const clean = exp.trim();
  if (NAMED_POWERS[clean]) return NAMED_POWERS[clean]!;
  if (/^-?\d+$/.test(clean)) {
    return `to the ${speakNumber(clean)}`;
  }
  return `to the ${clean}`;
}

function speakNumber(raw: string): string {
  if (raw.startsWith("-") && raw.length > 1) {
    return `negative ${raw.slice(1)}`;
  }
  return raw;
}

function wrapIfCompound(value: string): string {
  if (!value) return value;
  return /[+\-*/=]/.test(value) ? `(${value})` : value;
}

function speakLatex(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;

    if (ch === "\\") {
      const fracCmd = input.startsWith("\\dfrac", i)
        ? 6
        : input.startsWith("\\tfrac", i)
          ? 6
          : input.startsWith("\\frac", i)
            ? 5
            : 0;
      if (fracCmd) {
        const a = unwrapBraced(input, i + fracCmd);
        if (a) {
          const b = unwrapBraced(input, a.end);
          if (b) {
            const num = wrapIfCompound(speakLatex(a.inner).trim());
            const den = wrapIfCompound(speakLatex(b.inner).trim());
            out += ` ${num} over ${den} `;
            i = b.end;
            continue;
          }
        }
      }

      if (input.startsWith("\\sqrt", i)) {
        const after = i + 5;
        let end = after;
        if (input[after] === "[") {
          const close = input.indexOf("]", after);
          if (close >= 0) end = close + 1;
        }
        const braced = unwrapBraced(input, end);
        if (braced) {
          const inner = speakLatex(braced.inner).trim();
          const root = input[after] === "["
            ? input.slice(after + 1, end - 1)
            : "";
          out += root && root !== "2"
            ? `the ${root} root of ${inner}`
            : `the square root of ${inner}`;
          i = braced.end;
          continue;
        }
      }

      const textMatch = input
        .slice(i)
        .match(/^\\(text|mathrm|mathbf|textit|textrm)\{/);
      if (textMatch) {
        const braced = unwrapBraced(input, i + textMatch[0].length - 1);
        if (braced) {
          out += speakLatex(braced.inner);
          i = braced.end;
          continue;
        }
      }

      const delim = input
        .slice(i)
        .match(/^\\(left|right|bigl|bigr|Bigl|Bigr|biggl|biggr)\s*/);
      if (delim) {
        i += delim[0].length;
        continue;
      }

      const named = input.slice(i).match(/^\\([a-zA-Z]+)/);
      if (named) {
        const name = named[1]!;
        if (SIMPLE_SPOKEN[name] != null) {
          out += SIMPLE_SPOKEN[name];
        } else if (GREEK[name]) {
          out += GREEK[name];
        } else {
          out += name;
        }
        i += named[0].length;
        continue;
      }

      const esc = input[i + 1];
      if (esc && "{}%&#_$".includes(esc)) {
        out += esc;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "^") {
      const braced = unwrapBraced(input, i + 1);
      if (braced) {
        out += ` ${speakPower(speakLatex(braced.inner))} `;
        i = braced.end;
        continue;
      }
      if (input[i + 1]) {
        out += ` ${speakPower(input[i + 1]!)} `;
        i += 2;
        continue;
      }
    }

    if (ch === "_") {
      const braced = unwrapBraced(input, i + 1);
      if (braced) {
        out += ` sub ${speakLatex(braced.inner).trim()} `;
        i = braced.end;
        continue;
      }
      if (input[i + 1]) {
        out += ` sub ${input[i + 1]} `;
        i += 2;
        continue;
      }
    }

    out += ch;
    i += 1;
  }
  return out;
}

function stripMathDelimiters(input: string): string {
  return input
    .replace(/\$\$([\s\S]*?)\$\$/g, " $1 ")
    .replace(/\$([^$]+?)\$/g, " $1 ")
    .replace(/\\\(([\s\S]*?)\\\)/g, " $1 ")
    .replace(/\\\[([\s\S]*?)\\\]/g, " $1 ");
}

/** Diagram and implication arrows. Must run before ">" becomes "greater than". */
function speakArrows(input: string): string {
  return input
    .replace(/<->|↔|⇔|⟷/g, " to ")
    .replace(/-->|==>|=>|->|→|⟶|⇒|➜|➔|➞|➡|⇨/g, " to ")
    .replace(/<--|<-|←|⟵|⇐/g, " from ");
}

function speakMarks(input: string): string {
  let s = speakArrows(input);
  s = s.replace(/<=|≤/g, " less than or equal to ");
  s = s.replace(/>=|≥/g, " greater than or equal to ");
  // long_url, s3_key — not math subscripts. Leave x_1 and x_{i} for LaTeX.
  while (/([A-Za-z]{2,}|\d)_([A-Za-z]{2,})/.test(s)) {
    s = s.replace(/([A-Za-z]{2,}|\d)_([A-Za-z]{2,})/g, "$1 $2");
  }
  s = s.replace(/~/g, " about ");
  s = s.replace(/&/g, " and ");
  s = s.replace(/(\d)\s*ms\b/gi, "$1 milliseconds");
  s = s.replace(/(\d)\s*µs\b/g, "$1 microseconds");
  s = s.replace(/(\d+(?:\.\d+)?)M\b/g, "$1 million");
  s = s.replace(/(\d+(?:\.\d+)?)k\b/g, "$1 thousand");
  s = s.replace(/\bp(\d{2})\b/g, "p $1");
  s = s.replace(/\bI\/O\b/g, "I O");
  s = s.replace(/\b([A-Za-z]{2,})\/([A-Za-z]{2,})\b/g, (all, left: string, right: string) => {
    if (all.toLowerCase() === "and/or") return all;
    if (/^(day|days|sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|user|users|request|requests)$/i.test(right)) {
      return `${left} per ${right}`;
    }
    return `${left} and ${right}`;
  });
  return s;
}

function speakAsciiMath(input: string): string {
  let s = speakMarks(input);

  for (const [glyph, spoken] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.split(glyph).join(` ${spoken} `);
  }

  s = s
    .replace(/²/g, " squared ")
    .replace(/³/g, " cubed ")
    .replace(/√\s*\(([^)]+)\)/g, " the square root of $1 ")
    .replace(/√\s*([A-Za-z0-9]+)/g, " the square root of $1 ")
    .replace(/∫\s*_\{?([^{}\s]+)\}?\s*\^\{?([^{}\s]+)\}?/g, " the integral from $1 to $2 of ")
    .replace(/∫/g, " the integral of ")
    .replace(/∞/g, " infinity ")
    // Phonetic spellings — Deepgram often misreads bare "pi" / "mu"
    .replace(/μ₀|μ0/g, " mew naught ")
    .replace(/ε₀|ε0/g, " epsilon naught ")
    .replace(/π/g, " pie ")
    .replace(/θ/g, " thay-tuh ")
    .replace(/μ/g, " mew ")
    .replace(/ε/g, " epsilon ")
    .replace(/₀/g, " naught ")
    .replace(/×|·|⋅/g, " times ")
    .replace(/÷/g, " divided by ")
    .replace(/±/g, " plus or minus ")
    .replace(/≠/g, " is not equal to ")
    .replace(/≈/g, " approximately ")
    .replace(/°/g, " degrees ");

  // x^2, 3x^{2}, (x+1)^n — after LaTeX unwrap these are still around.
  s = s.replace(/\^\{([^{}]+)\}/g, (_, exp: string) => ` ${speakPower(exp)} `);
  s = s.replace(/\^(-?\d+|[A-Za-z])/g, (_, exp: string) => ` ${speakPower(exp)} `);

  s = s.replace(/_\{([^{}]+)\}/g, " sub $1 ");
  s = s.replace(/_([A-Za-z0-9])/g, " sub $1 ");

  // 1/2, (1/2), 3x/4 — skip word/word like and/or.
  s = s.replace(
    /(?<![A-Za-z]{2})(\d+(?:\.\d+)?|\([^()\/]{1,24}\)|\b[A-Za-z]\b)\s*\/\s*(\d+(?:\.\d+)?|\([^()\/]{1,24}\)|\b[A-Za-z]\b)(?![A-Za-z]{2})/g,
    "$1 over $2",
  );

  // 2x, 3y, 4π — a number stuck to a single-letter variable.
  s = s.replace(/(\d+(?:\.\d+)?)\s*([A-Za-zπθ])\b/g, "$1 $2");

  // 3(x+1) → 3 times (x+1). Only a lone letter, so "We (" stays put.
  s = s.replace(/(\d+(?:\.\d+)?)\s*\(/g, "$1 times (");
  s = s.replace(/\b([A-Za-z])\s*\(/g, "$1 times (");

  s = s.replace(
    /(\d|\b[A-Za-z]\b)\s*\*\s*(\d|\b[A-Za-z]\b)/g,
    "$1 times $2",
  );

  s = s.replace(/\+/g, " plus ");

  // Unary minus after = ( or + or the start — not "2x - 5".
  // Must run before "=" becomes "equals".
  s = s.replace(
    /(^|[=(+*/×÷])\s*[-−](\d+(?:\.\d+)?)/g,
    (_, lead: string, n: string) => `${lead} negative ${n}`,
  );
  // 6-2, 2x-5, x - y. Leave word hyphens like left-hand alone.
  s = s.replace(
    /(?<=[\dπθ\)])\s*[-−–]\s*(?=[\dA-Za-zπθ\(]|negative)/g,
    " minus ",
  );
  s = s.replace(
    /(?<=[A-Za-z])\s+[-−–]\s+(?=[\dA-Za-zπθ\(]|negative)/g,
    " minus ",
  );
  s = s.replace(/(?<=\b[A-Za-z])[-−](?=\d)/g, " minus ");
  s = s.replace(/(?<=\b[A-Za-z])[-−](?=[A-Za-z]\b)/g, " minus ");

  s = s.replace(/=/g, " equals ");

  s = s.replace(/</g, " less than ");
  s = s.replace(/>/g, " greater than ");

  // Drop grouping marks so the voice does not say "open parenthesis".
  s = s.replace(/[()]/g, " ");

  return s;
}

function tidySpoken(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\bplus or minus\b/g, "plus or minus")
    .trim();
}

/**
 * Speakable form of a tutor line. Leaves ordinary English alone; expands
 * fractions, powers, and operators so the voice does not spell symbols.
 */
export function mathToSpeech(input: string): string {
  let s = input.trim();
  if (!s) return s;

  while (s.includes("\\\\")) {
    s = s.replace(/\\\\/g, "\\");
  }

  s = speakMarks(s);
  s = stripMathDelimiters(s);
  s = speakLatex(s);
  s = speakAsciiMath(s);
  return tidySpoken(s);
}
