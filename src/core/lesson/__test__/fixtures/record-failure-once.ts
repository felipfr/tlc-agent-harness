import { recordLessonFromFailure } from "../../lesson.service.ts";

const [, , root, gate, fingerprint] = process.argv;
if (!root || !gate || !fingerprint) {
  console.error("usage: record-failure-once.ts <root> <gate> <fingerprint>");
  process.exit(1);
}

await recordLessonFromFailure({
  projectDir: root,
  gate,
  category: "verification",
  fingerprint,
  output: `${gate} failed`,
  sessionKey: "s-1",
});
