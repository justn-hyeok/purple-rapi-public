import assert from "node:assert/strict";
import test from "node:test";
import { CommunityFeeds } from "../packages/agent/src/community-feeds.js";

test("AI blog cards show feed text without markup or entities", async () => {
  const drafts: Array<{ embeds: Array<Record<string, unknown>> }> = [];
  const store = {
    communityPostExists: async () => false,
    officialItems: async () => [
      {
        id: "1",
        source: "Example",
        title: "It&#8217;s <b>new</b>",
        url: "https://example.com/a",
        summary: "<p>소개 &lt;img src=x&gt; 문장</p>",
      },
    ],
    citationCandidates: async () => [],
    saveCommunityDraft: async (draft: {
      embeds: Array<Record<string, unknown>>;
    }) => {
      drafts.push(draft);
    },
  };
  const feeds = new CommunityFeeds(store as never, undefined, {
    guildId: "g",
    owner: "o",
    post: async () => "m",
  });
  await feeds.aiBlogs(new Date("2026-10-27T01:00:00Z"));
  const embed = drafts[0]!.embeds[0]!;
  assert.equal(embed.title, "Example · 1건");
  assert.equal(
    embed.description,
    "**[It’s new](https://example.com/a)**\n소개 문장",
  );
});

test("the AI blog message stays under Discord's total embed limit", async () => {
  const drafts: Array<{ embeds: Array<Record<string, string>> }> = [];
  const long = "가".repeat(300);
  const store = {
    communityPostExists: async () => false,
    officialItems: async () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: String(i),
        source: `Source ${i % 10}`,
        title: `${long} ${i}`,
        url: `https://example.com/${"path/".repeat(30)}${i}`,
        summary: long,
      })),
    citationCandidates: async () => [],
    saveCommunityDraft: async (draft: {
      embeds: Array<Record<string, string>>;
    }) => {
      drafts.push(draft);
    },
  };
  const feeds = new CommunityFeeds(store as never, undefined, {
    guildId: "g",
    owner: "o",
    post: async () => "m",
  });
  await feeds.aiBlogs(new Date("2026-10-27T01:00:00Z"));
  const total = drafts[0]!.embeds.reduce(
    (sum, e) => sum + e.title!.length + e.description!.length,
    0,
  );
  assert.ok(total > 1000 && total <= 6000, `total ${total}`);
});

const blogFeeds = (
  summarizer: unknown,
  items: Array<Record<string, string>>,
  sink: {
    drafts: Array<{ embeds: Array<Record<string, string>> }>;
    marked: string[];
  },
) =>
  new CommunityFeeds(
    {
      communityPostExists: async () => false,
      officialItems: async () => items,
      citationCandidates: async () => [],
      saveCommunityDraft: async (draft: {
        embeds: Array<Record<string, string>>;
      }) => {
        sink.drafts.push(draft);
      },
      recordCommunityPost: async (post: { key: string }) => {
        sink.marked.push(post.key);
      },
    } as never,
    summarizer as never,
    { guildId: "g", owner: "o", post: async () => "m" },
  );
const blogItem = (id: string, summary = "English excerpt of the post") => ({
  id,
  source: "Vendor",
  title: `Post ${id}`,
  url: `https://example.com/${id}`,
  summary,
});
const now = new Date("2026-10-27T01:00:00Z");

test("the model's Korean summary is shown and its rejects are dropped", async () => {
  const sink = { drafts: [], marked: [] };
  await blogFeeds(
    {
      policy: "t",
      summarize: async () => new Map(),
      curate: async () => new Map([["a", "새 도구를 쓸 수 있게 됐어요."]]),
    },
    [blogItem("a"), blogItem("b")],
    sink,
  ).aiBlogs(now);
  const text = (
    sink.drafts[0] as never as { embeds: Array<Record<string, string>> }
  ).embeds[0]!.description!;
  assert.match(text, /새 도구를 쓸 수 있게 됐어요/);
  assert.doesNotMatch(text, /Post b|English excerpt/);
});

test("without a working model, posts go out with no untranslated excerpt", async () => {
  const sink = { drafts: [], marked: [] };
  await blogFeeds(
    {
      policy: "t",
      summarize: async () => new Map(),
      curate: async () => {
        throw new Error("codex down");
      },
    },
    [blogItem("a"), blogItem("b", "규칙 요약인 한국어 문장이에요.")],
    sink,
  ).aiBlogs(now);
  const text = (
    sink.drafts[0] as never as { embeds: Array<Record<string, string>> }
  ).embeds[0]!.description!;
  assert.match(text, /Post a/);
  assert.doesNotMatch(text, /English excerpt/);
  assert.match(text, /규칙 요약인 한국어 문장이에요/);
});

test("a day where the model rejects everything is settled, not retried", async () => {
  const sink = { drafts: [], marked: [] as string[] };
  await blogFeeds(
    {
      policy: "t",
      summarize: async () => new Map(),
      curate: async () => new Map(),
    },
    [blogItem("a")],
    sink,
  ).aiBlogs(now);
  assert.equal(sink.drafts.length, 0);
  assert.deepEqual(sink.marked, ["ai-blogs:2026-10-27"]);
});
