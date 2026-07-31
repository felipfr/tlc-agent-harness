export type ShellWord = {
  text: string;
  /** True when the word carries a `$var`, `$(...)` or backtick — its value is not knowable here. */
  unresolved: boolean;
  /**
   * True when the word opened with a quote, so every operator inside it is literal text. A caller looking
   * for redirects must skip these: `'{"cmd":"x > cfg"}'` is one quoted argument, not a redirect.
   * Only the opening matters — `>"$f"` starts unquoted and is a real redirect.
   */
  quotedStart: boolean;
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

// hazard: a heredoc body is data being written, not a command list. Tokenizing it invents segments whose
// head verb never runs, and its quotes make the whole command look unbalanced. It is separated here rather
// than discarded, because `python3 - <<PY` makes that body the program — a caller that never sees it cannot
// tell a document from a script.
/**
 * A heredoc body, paired with the command text that preceded its `<<TAG` marker. The prefix is what
 * identifies the verb the body is fed to — without it, a body can only be attributed to the command as a
 * whole, which mistakes `cat <<EOF ... ; node x` for a program handed to node.
 */
export type HeredocChunk = { body: string; prefix: string };

export function splitHeredocs(command: string): { stripped: string; heredocs: HeredocChunk[] } {
  const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
  const heredocs: HeredocChunk[] = [];
  let rest = command;
  let stripped = "";
  for (;;) {
    const match = heredoc.exec(rest);
    if (!match) {
      stripped += rest;
      break;
    }
    const bodyStart = rest.indexOf("\n", match.index + match[0].length);
    const prefix = stripped + rest.slice(0, match.index);
    stripped += rest.slice(0, match.index);
    if (bodyStart === -1) {
      break;
    }
    const terminator = new RegExp(`^\\s*${match[2] as string}\\s*$`, "m");
    const body = rest.slice(bodyStart + 1);
    const end = terminator.exec(body);
    if (!end) {
      heredocs.push({ body, prefix });
      break;
    }
    heredocs.push({ body: body.slice(0, end.index), prefix });
    rest = body.slice(end.index + end[0].length);
  }
  return { stripped, heredocs };
}

export function heredocChunks(command: string): HeredocChunk[] {
  return splitHeredocs(command).heredocs;
}

// invariant: this splits words, it does not evaluate them. Anything it cannot split with confidence
// is reported as opaque so callers can refuse rather than guess — a wrong split must never read as
// a safe command.
export function tokenizeShell(command: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let words: ShellWord[] = [];
  let current = "";
  let currentHadQuote = false;
  let currentStartedQuoted = false;
  let quote: '"' | "'" | null = null;
  let unbalanced = false;
  let depth = 0;

  function pushWord(): void {
    if (current !== "" || currentHadQuote) {
      words.push({
        text: current,
        unresolved: isExpansion(current),
        quotedStart: currentStartedQuoted,
      });
    }
    current = "";
    currentHadQuote = false;
    currentStartedQuoted = false;
  }

  function pushSegment(): void {
    pushWord();
    if (words.length > 0) {
      segments.push({ words, opaque: unbalanced });
    }
    words = [];
  }

  const { stripped } = splitHeredocs(command);

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
      if (current === "" && !currentHadQuote) {
        currentStartedQuoted = true;
      }
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
