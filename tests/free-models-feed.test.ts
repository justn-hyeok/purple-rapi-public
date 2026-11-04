import assert from "node:assert/strict";
import test from "node:test";
import { CommunityFeeds } from "../packages/agent/src/community-feeds.js";

type Embed = { title: string; description: string; url?: string };

function harness(catalog: unknown, openRouter: unknown[] = []) {
  const keys = new Set<string>();
  const posts: Embed[] = [];
  const state = { catalog, openRouter };
  const store = {
    communityPostKeys: async (prefix: string) =>
      [...keys].filter((key) => key.startsWith(prefix)),
    communityPostExists: async (key: string) => keys.has(key),
    recordCommunityPost: async (post: { key: string }) => {
      keys.add(post.key);
    },
    deleteCommunityMarkers: async (gone: string[]) => {
      for (const key of gone) keys.delete(key);
    },
    managedDiscordResourceId: async () => "channel",
  };
  const feeds = new CommunityFeeds(store as never, undefined, {
    guildId: "g",
    owner: "o",
    autoPost: { "free-tokens": true },
    post: async (_channel, embeds) => {
      posts.push(embeds[0] as Embed);
      return "m";
    },
    getJson: async (url) =>
      url.includes("openrouter") ? { data: state.openRouter } : state.catalog,
  });
  return { feeds, keys, posts, state };
}

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  cost: { input: 0, output: 0 },
  tool_call: true,
  ...extra,
});
const zen = (...models: Array<ReturnType<typeof model>>) => ({
  opencode: {
    models: Object.fromEntries(models.map((m) => [m.id, m])),
  },
});

test("a provider's first list is posted once and not counted as new for learners", async () => {
  const { feeds, keys, posts } = harness(zen(model("a"), model("b")));
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 1);
  assert.match(posts[0]!.title, /OpenCode Zen에서 지금 무료인 모델 2개/);
  assert.equal(posts[0]!.url, "https://opencode.ai/docs/zen/");
  assert.match(posts[0]!.description, /^사용법: OpenCode/);
  assert.ok(keys.has("free-seen:opencode:a"));
  assert.ok(![...keys].some((key) => key.startsWith("free-model:")));
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 1);
});

test("paid, deprecated and tool-less models are not announced", async () => {
  const { feeds, posts } = harness(
    zen(
      model("keep"),
      model("paid", { cost: { input: 1, output: 0 } }),
      model("nocost", { cost: undefined }),
      model("old", { status: "deprecated" }),
      model("embed", { tool_call: false }),
    ),
  );
  await feeds.freeCatalogModels();
  assert.match(posts[0]!.title, /모델 1개/);
  assert.match(posts[0]!.description, /`keep`/);
});

test("coding-plan providers are ignored even when every row is $0", async () => {
  const { feeds, posts } = harness({
    "alibaba-coding-plan": { models: { a: model("a") } },
  });
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 0);
});

test("a later model is new for learners, and an ended one waits for a second check", async () => {
  const { feeds, keys, posts, state } = harness(
    zen(model("a"), model("b"), model("c")),
  );
  await feeds.freeCatalogModels();
  state.catalog = zen(model("a"), model("c"), model("d"));
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 2);
  assert.match(posts[1]!.title, /새 무료 모델 1개$/);
  assert.ok(keys.has("free-model:opencode:d"));
  state.catalog = zen(model("a"), model("c"), model("d"), model("e"));
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 3);
  assert.match(posts[2]!.title, /새 무료 모델 1개 · 무료 종료 1개/);
  assert.match(posts[2]!.description, /더 이상 무료 아님\*\*\n- `b`/);
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 3);
});

test("a list that collapses is treated as a catalog problem, not mass ending", async () => {
  const { feeds, posts, state } = harness(
    zen(model("a"), model("b"), model("c"), model("d"), model("e")),
  );
  await feeds.freeCatalogModels();
  state.catalog = zen(model("a"));
  await feeds.freeCatalogModels();
  state.catalog = {};
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 1);
});

test("OpenRouter's existing markers keep working next to catalog markers", async () => {
  const free = (id: string) => ({
    id,
    supported_parameters: ["tools"],
    pricing: { prompt: "0", completion: "0" },
  });
  const { feeds, keys, posts, state } = harness({}, [free("x/a:free")]);
  keys.add("free-model:x/a:free");
  keys.add("free-model:opencode:z");
  await feeds.freeModels();
  assert.equal(posts.length, 0, "catalog markers must not read as ended");
  state.openRouter = [free("x/a:free"), free("x/b:free")];
  await feeds.freeModels();
  assert.match(posts[0]!.title, /OpenRouter 새 무료 모델 1개/);
});

test("OpenRouter cards say what a model can do and when it stops being free", async () => {
  const { feeds, posts } = harness({}, [
    {
      id: "x/a:free",
      name: "A",
      context_length: 262144,
      supported_parameters: ["tools"],
      expiration_date: "2026-12-31",
      pricing: { prompt: "0", completion: "0" },
    },
    {
      id: "google/lyria",
      pricing: { prompt: "0", completion: "0" },
    },
  ]);
  await feeds.freeModels();
  assert.match(
    posts[0]!.description,
    /\*\*A\*\* `x\/a:free` · 컨텍스트 262K · 2026-12-31까지 무료/,
  );
  assert.doesNotMatch(posts[0]!.description, /lyria/);
});

test("a known tool-less model still free is not reported as ended", async () => {
  const { feeds, keys, posts } = harness({}, [
    {
      id: "google/lyria",
      pricing: { prompt: "0", completion: "0" },
    },
  ]);
  keys.add("free-model:google/lyria");
  await feeds.freeModels();
  assert.equal(posts.length, 0);
});

test("a model missing from one response only is never reported", async () => {
  const { feeds, posts, state } = harness(zen(model("a"), model("b")));
  await feeds.freeCatalogModels();
  state.catalog = zen(model("a"));
  await feeds.freeCatalogModels();
  state.catalog = zen(model("a"), model("b"));
  await feeds.freeCatalogModels();
  state.catalog = zen(model("a"));
  await feeds.freeCatalogModels();
  assert.equal(posts.length, 1, "two separate misses are not two in a row");
});

test("a model that came back can be reported as ended again", async () => {
  const { feeds, keys, posts, state } = harness(zen(model("a"), model("b")));
  keys.add("free-model-ended:opencode:b");
  keys.add("free-seen:opencode:b");
  await feeds.freeCatalogModels();
  assert.ok(!keys.has("free-model-ended:opencode:b"));
  state.catalog = zen(model("a"));
  await feeds.freeCatalogModels();
  await feeds.freeCatalogModels();
  assert.match(posts.at(-1)!.title, /무료 종료 1개/);
});
