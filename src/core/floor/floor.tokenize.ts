export type ShellWord = {
  text: string;
  /** True when the word carries a `$var`, `$(...)` or backtick — its value is not knowable here. */
  unresolved: boolean;
};

export type ShellSegment = {
  words: ShellWord[];
  /**
   * True when the segment could not be split with confidence. Which *verbs* defeat inspection is a
   * policy question and belongs to the caller — this only reports failures of splitting.
   */
  opaque: boolean;
};

const SEPARATORS = new Set([";", "|", "&", "\n"]);
const ESCAPABLE = new Set([" ", "\t", '"', "'", "$", "`", "\\", ";", "|", "&", "(", ")"]);

function isExpansion(text: string): boolean {
  return text.includes("$") || text.includes("`");
}

// invariant: this splits words, it does not evaluate them. Anything it cannot split with confidence
// is reported as opaque so callers can refuse rather than guess — a wrong split must never read as
// a safe command.
export function tokenizeShell(command: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let words: ShellWord[] = [];
  let current = "";
  let currentHadQuote = false;
  let quote: '"' | "'" | null = null;
  let unbalanced = false;
  let depth = 0;

  function pushWord(): void {
    if (current !== "" || currentHadQuote) {
      words.push({ text: current, unresolved: isExpansion(current) });
    }
    current = "";
    currentHadQuote = false;
  }

  function pushSegment(): void {
    pushWord();
    if (words.length > 0) {
      segments.push({ words, opaque: unbalanced });
    }
    words = [];
  }

  // hazard: a heredoc body is data being written, not a command list. Tokenizing it invents
  // segments whose head verb never runs, and its quotes make the whole command look unbalanced.
  const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
  let rest = command;
  let stripped = "";
  for (;;) {
    const match = heredoc.exec(rest);
    if (!match) {
      stripped += rest;
      break;
    }
    const bodyStart = rest.indexOf("\n", match.index + match[0].length);
    stripped += rest.slice(0, match.index);
    if (bodyStart === -1) {
      break;
    }
    const terminator = new RegExp(`^\\s*${match[2] as string}\\s*$`, "m");
    const body = rest.slice(bodyStart + 1);
    const end = terminator.exec(body);
    if (!end) {
      break;
    }
    rest = body.slice(end.index + end[0].length);
  }

  for (let index = 0; index < stripped.length; index += 1) {
    const char = stripped[index] as string;

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    // hazard: treating every backslash as an escape turned `C:\Users\me\.ssh\id_rsa` into
    // `C:Usersme.sshid_rsa`, so no Windows path resolved and the secret rule silently passed it.
    // A backslash only escapes what actually needs escaping; anything else is part of the path.
    if (char === "\\") {
      const next = stripped[index + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      currentHadQuote = true;
      continue;
    }

    // hazard: a separator inside $( ) or ${ } belongs to the substitution, not to the command list.
    // Splitting there would hand a fragment to the rules and lose the real verb.
    if (char === "$" && (stripped[index + 1] === "(" || stripped[index + 1] === "{")) {
      depth += 1;
      current += char;
      continue;
    }
    if (depth > 0 && (char === ")" || char === "}")) {
      depth -= 1;
      current += char;
      continue;
    }

    if (depth === 0 && SEPARATORS.has(char)) {
      pushSegment();
      continue;
    }

    if (depth === 0 && (char === " " || char === "\t")) {
      pushWord();
      continue;
    }

    current += char;
  }

  if (quote !== null || depth > 0) {
    unbalanced = true;
  }
  pushSegment();

  // why: an unbalanced quote is only detectable at the end, so segments split before it were judged
  // under the wrong assumption. Re-mark the whole list rather than trust those splits.
  return unbalanced ? segments.map((segment) => ({ ...segment, opaque: true })) : segments;
}
