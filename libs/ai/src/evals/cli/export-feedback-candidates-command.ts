import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import type { AiEnv } from '../../infrastructure/config/parse-ai-config';
import type { TextWriter } from '../runner/eval-ports';
import {
  candidatesPath,
  feedbackDocsToCandidateLines,
  hashGuardedGoldens,
  type FeedbackDoc,
  writeCandidatesJsonl,
} from '../export/feedback-candidates';
import { EXIT_CODES, type ExitCode } from './args';
import {
  parseExportFeedbackArgs,
  type ExportFeedbackArgs,
} from './export-feedback-args';

// Comando `nx run ai:export-feedback-candidates` (cv-suggestions-review 4.3). Lee `ai_feedback` (Mongo o JSON) y
// escribe `candidates.jsonl` sin modificar ningún golden.

const AI_FEEDBACK_COLLECTION = 'ai_feedback';

export interface ExportFeedbackCliIo {
  env: AiEnv;
  cwd: string;
  stdout: TextWriter;
  stderr: TextWriter;
}

export async function runExportFeedbackCommand(
  argv: readonly string[],
  io: ExportFeedbackCliIo,
): Promise<ExitCode> {
  const parsed = parseExportFeedbackArgs(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.message}\n`);
    return EXIT_CODES.usage;
  }
  const args = parsed.args;
  const evalsDir = resolve(io.cwd, args.evalsDir);
  const outPath = resolve(
    io.cwd,
    args.out ?? candidatesPath(args.evalsDir),
  );

  const before = await hashGuardedGoldens(evalsDir);

  let docs: FeedbackDoc[];
  try {
    docs = await loadFeedbackDocs(args, io);
  } catch (error) {
    io.stderr(
      `[ai:export-feedback-candidates] ${error instanceof Error ? error.message : 'failed to load feedback'}\n`,
    );
    return EXIT_CODES.usage;
  }

  let lines;
  try {
    lines = feedbackDocsToCandidateLines(docs);
  } catch (error) {
    io.stderr(
      `[ai:export-feedback-candidates] ${error instanceof Error ? error.message : 'invalid feedback docs'}\n`,
    );
    return EXIT_CODES.usage;
  }

  await writeCandidatesJsonl(outPath, lines);

  const after = await hashGuardedGoldens(evalsDir);
  for (const task of before.keys()) {
    if (before.get(task) !== after.get(task)) {
      io.stderr(
        `[ai:export-feedback-candidates] golden of ${task} changed during export; aborting integrity check\n`,
      );
      return EXIT_CODES.programming;
    }
  }

  io.stdout(
    `[ai:export-feedback-candidates] wrote ${String(lines.length)} candidate(s) to ${outPath}\n`,
  );
  return EXIT_CODES.success;
}

async function loadFeedbackDocs(
  args: ExportFeedbackArgs,
  io: ExportFeedbackCliIo,
): Promise<FeedbackDoc[]> {
  if (args.fromJson !== undefined) {
    const path = resolve(io.cwd, args.fromJson);
    const raw = await readFile(path, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error('--from-json must contain a JSON array');
    }
    return data as FeedbackDoc[];
  }

  const uri =
    args.mongoUri ??
    (typeof io.env['MONGO_URI'] === 'string' ? io.env['MONGO_URI'] : undefined);
  if (uri === undefined || uri === '') {
    throw new Error(
      'provide --from-json=<file> or --mongo-uri / MONGO_URI to read ai_feedback',
    );
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const docs = await client
      .db()
      .collection(AI_FEEDBACK_COLLECTION)
      .find({})
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map((doc) => ({
      _id: doc._id,
      userId: doc['userId'],
      analysisId: doc['analysisId'],
      suggestionIndex: doc['suggestionIndex'] as number,
      afterHash: doc['afterHash'] as string,
      createdAt: doc['createdAt'] as Date | string,
    }));
  } finally {
    await client.close();
  }
}
