#!/usr/bin/env node
// zunaari music 公式サイト：静的ページ生成スクリプト（Phase 3-1）
//
// 入力：_src/data/catalog.json（公開用データ。許可した項目だけを持つ）
//       _src/build.config.json（生成するページの範囲・試作モード）
// 出力：index.html の生成範囲（目印コメントの間）、music/、releases/ 以下の各ページ、
//       404.html、sitemap.xml、robots.txt
//
// 使い方：
//   node _build/build.mjs            検査してから生成（書き込み）
//   node _build/build.mjs --check    生成結果とファイルが一致するかだけを確認（書き込まない）
//   node _build/build.mjs --data <file> --config <file> --root <dir>   入力・出力先の差し替え（テスト用）
//   node _build/build.mjs --forbidden <ファイル>   公開してはいけない語の一覧（公開リポジトリ外で管理）でもデータを検査する
//   node _build/build.mjs --root <作業コピー> --production   本番用の出力（noindex を外し、sitemap に全ページを載せる）。
//                                    リポジトリを誤って本番用に書き換えないよう、--root で作業コピーを指定したときだけ使える
//
// 依存パッケージなし（Node.js 18以上）。同じ入力からは常に同じ出力になる（日時・乱数を出力に使わない）。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ROOT = resolve(opt('--root', join(dirname(fileURLToPath(import.meta.url)), '..')));
const DATA = resolve(opt('--data', join(ROOT, '_src/data/catalog.json')));
const CONFIG = resolve(opt('--config', join(ROOT, '_src/build.config.json')));
const CHECK = args.includes('--check');
const PRODUCTION = args.includes('--production');
if (PRODUCTION && !args.includes('--root')) {
  console.error('--production は --root で作業コピーを指定したときだけ使えます（リポジトリは試作モードのまま保つ）');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. 読み込みと検査
// ---------------------------------------------------------------------------
const catalog = JSON.parse(readFileSync(DATA, 'utf8'));
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
// 試作モード：全ページに noindex を付け、sitemap には Home だけを載せる
const PREVIEW = PRODUCTION ? false : config.preview === true;
// SNS 共有時の画像：cover＝ジャケット（YouTubeのみの楽曲は動画画像）、common＝全ページでサイト共通画像（images/ogp.jpg）
const OG_IMAGE = config.ogImage ?? 'cover';

const errors = [];
const err = (msg) => errors.push(msg);

// 許可リスト：ここにない項目があれば検査エラー（新しい項目は明示的に許可しない限り公開されない）
const ALLOWED = {
  top: ['schemaVersion', 'site', 'artists', 'works', 'recordings', 'releases', 'videos', 'home'],
  site: ['name', 'baseUrl', 'defaultOgImage'],
  artist: ['slug', 'name', 'kind', 'canVocal'],
  work: ['slug', 'title', 'genres', 'series'],
  recording: ['slug', 'work', 'title', 'versionLabel', 'displayArtist', 'durationMs', 'lyricsType', 'credits', 'isrc'],
  credit: ['artist', 'participation', 'role'],
  release: ['slug', 'title', 'type', 'releaseDate', 'displayArtist', 'cover', 'links', 'tracks'],
  track: ['disc', 'no', 'recording', 'links'],
  video: ['id', 'slug', 'recording', 'kind', 'published', 'title', 'subtitle', 'image', 'description'],
  home: ['latestVideo', 'releases'],
  config: ['preview', 'pages', 'ogImage'],
};
const ENUM = {
  artistKind: ['project', 'character', 'collaborator', 'unit'],
  releaseType: ['single', 'ep', 'album', 'compilation'],
  lyricsType: ['ja', 'en', 'mixed', 'instrumental', null],
  participation: ['main', 'featured', 'with'],
  role: ['vocal', 'dj', 'instrumental'],
  // official-music-video = 公式MV（「MVを見る」）、audio = 配信版と同じ音源と確認済みの動画（「YouTubeで聴く」）、
  // null = 未分類（ページには出さない）
  videoKind: ['official-music-video', 'audio', null],
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// 内部情報の混入を防ぐ検出。公開コードにはローカルパスの検出だけを書き、
// 管理番号の形式や禁止語の一覧は公開リポジトリ外のファイルから --forbidden で読み込む（1行に1つの正規表現。# で始まる行は無視）
const FORBIDDEN = [/[A-Z]:\\/, /\/Users\//];
if (opt('--forbidden')) {
  for (const line of readFileSync(resolve(opt('--forbidden')), 'utf8').split(/\r?\n/)) {
    if (line.trim() && !line.startsWith('#')) FORBIDDEN.push(new RegExp(line.trim(), 'i'));
  }
}

function keysOnly(obj, allowed, where) {
  if (!obj || typeof obj !== 'object') return err(`${where}: オブジェクトではない`);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${where}: 許可されていない項目「${k}」`);
}
function walkStrings(v, where) {
  if (typeof v === 'string') {
    for (const re of FORBIDDEN) if (re.test(v)) err(`${where}: 公開してはいけない形式の文字列（${re}）`);
  } else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${where}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, `${where}.${k}`);
}
function validDate(s, where) {
  if (typeof s !== 'string' || !DATE.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) return err(`${where}: 日付の形式が不正（${s}）`);
  const today = new Date().toISOString().slice(0, 10);
  if (s > today) err(`${where}: 未来の日付（${s}）は公開データに入れない`);
}
function uniqueSlugs(list, where) {
  const seen = new Set();
  for (const x of list) {
    if (!SLUG.test(x.slug || '')) err(`${where}: slugの形式が不正（${x.slug}）`);
    if (seen.has(x.slug)) err(`${where}: slugが重複（${x.slug}）`);
    seen.add(x.slug);
  }
}
const fileExists = (rel) => existsSync(join(ROOT, rel));

keysOnly(catalog, ALLOWED.top, 'catalog');
keysOnly(config, ALLOWED.config, 'build.config');
if (config.ogImage !== undefined && !['cover', 'common'].includes(config.ogImage)) err(`build.config.ogImage は "cover" か "common"（${config.ogImage}）`);
if (catalog.schemaVersion !== 1) err(`schemaVersion が 1 ではない（${catalog.schemaVersion}）`);
keysOnly(catalog.site, ALLOWED.site, 'site');
walkStrings(catalog, 'catalog');

const artists = new Map(), works = new Map(), recordings = new Map(), releases = new Map(), videos = new Map();
for (const [list, map, allowed, name] of [
  [catalog.artists, artists, ALLOWED.artist, 'artists'],
  [catalog.works, works, ALLOWED.work, 'works'],
  [catalog.recordings, recordings, ALLOWED.recording, 'recordings'],
  [catalog.releases, releases, ALLOWED.release, 'releases'],
  [catalog.videos, videos, ALLOWED.video, 'videos'],
]) {
  if (!Array.isArray(list)) { err(`${name}: 配列ではない`); continue; }
  uniqueSlugs(list, name);
  list.forEach((x, i) => { keysOnly(x, allowed, `${name}[${i}]`); map.set(x.slug, x); });
}

for (const a of artists.values()) {
  if (!ENUM.artistKind.includes(a.kind)) err(`artist ${a.slug}: kind が不正（${a.kind}）`);
  if (a.kind === 'character' && typeof a.canVocal !== 'boolean') err(`artist ${a.slug}: キャラクターには canVocal（正典設定）が必要`);
}
for (const w of works.values()) {
  if (!w.title) err(`work ${w.slug}: title がない`);
  for (const k of ['genres', 'series']) if (w[k] !== undefined && !Array.isArray(w[k])) err(`work ${w.slug}: ${k} は配列`);
}
const isrcSeen = new Map();
for (const r of recordings.values()) {
  if (!works.has(r.work)) err(`recording ${r.slug}: 楽曲 ${r.work} が存在しない`);
  // 音源の曲名は楽曲名と違うとき（例：〜 (AIRI Chapter)）だけ持つ。同じ情報を2か所に持たない（設計書4.1 P4）
  if (r.title !== undefined && (!r.title || r.title === works.get(r.work)?.title)) err(`recording ${r.slug}: title は楽曲名と異なる場合だけ指定する`);
  if (!r.displayArtist) err(`recording ${r.slug}: displayArtist が必要`);
  for (const name of String(r.displayArtist || '').split(', ')) if (![...artists.values()].some((a) => a.name === name)) err(`recording ${r.slug}: 名義「${name}」が artists にない`);
  if (!ENUM.lyricsType.includes(r.lyricsType ?? null)) err(`recording ${r.slug}: lyricsType が不正`);
  if (r.durationMs !== null && r.durationMs !== undefined && !(Number.isInteger(r.durationMs) && r.durationMs > 0)) err(`recording ${r.slug}: durationMs が不正`);
  if (r.isrc !== undefined) {
    if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(r.isrc)) err(`recording ${r.slug}: ISRCの形式が不正`);
    if (isrcSeen.has(r.isrc)) err(`recording ${r.slug}: ISRC が ${isrcSeen.get(r.isrc)} と重複（同一音源なら1つの音源にまとめる）`);
    isrcSeen.set(r.isrc, r.slug);
  }
  const credits = r.credits || [];
  credits.forEach((c, i) => {
    keysOnly(c, ALLOWED.credit, `recording ${r.slug}.credits[${i}]`);
    const a = artists.get(c.artist);
    if (!a) err(`recording ${r.slug}: 参加者 ${c.artist} が存在しない`);
    if (!ENUM.participation.includes(c.participation)) err(`recording ${r.slug}: participation が不正`);
    if (!ENUM.role.includes(c.role)) err(`recording ${r.slug}: role が不正`);
    if (a && a.canVocal === false && c.role === 'vocal') err(`recording ${r.slug}: ${a.name} は歌わない設定（canVocal=false）なのに vocal が付いている`);
  });
  if (['ja', 'en', 'mixed'].includes(r.lyricsType) && !credits.some((c) => c.role === 'vocal')) err(`recording ${r.slug}: ボーカル曲なのに vocal の参加者がいない`);
}
const spotifyUrlOwner = new Map();
const claimUrl = (url, owner, where) => {
  if (!/^https:\/\/open\.spotify\.com\/(album|track)\/[A-Za-z0-9]{22}$/.test(url)) err(`${where}: Spotify URL の形式が不正（${url}）`);
  if (spotifyUrlOwner.has(url) && spotifyUrlOwner.get(url) !== owner) err(`${where}: 同じ配信URLが別の作品に割り当てられている（${url}）`);
  spotifyUrlOwner.set(url, owner);
};
for (const rel of releases.values()) {
  if (!ENUM.releaseType.includes(rel.type)) err(`release ${rel.slug}: type が不正`);
  validDate(rel.releaseDate, `release ${rel.slug}`);
  if (!rel.displayArtist) err(`release ${rel.slug}: displayArtist が必要`);
  for (const w of rel.cover?.widths || []) if (!fileExists(`${rel.cover.base}-${w}.webp`)) err(`release ${rel.slug}: ジャケット画像がない（${rel.cover.base}-${w}.webp）`);
  if (rel.links?.spotify) claimUrl(rel.links.spotify, `release:${rel.slug}`, `release ${rel.slug}`);
  const pos = new Set();
  (rel.tracks || []).forEach((t, i) => {
    keysOnly(t, ALLOWED.track, `release ${rel.slug}.tracks[${i}]`);
    const key = `${t.disc}-${t.no}`;
    if (pos.has(key)) err(`release ${rel.slug}: 収録枠 disc ${t.disc} no ${t.no} が重複`);
    pos.add(key);
    if (t.no !== i + 1 || t.disc !== 1) err(`release ${rel.slug}: 収録順が連番ではない（${key}）`);
    if (!recordings.has(t.recording)) err(`release ${rel.slug}: 音源 ${t.recording} が存在しない`);
    if (t.links?.spotify) claimUrl(t.links.spotify, `recording:${t.recording}`, `release ${rel.slug} track ${t.no}`);
  });
  if (!rel.tracks?.length) err(`release ${rel.slug}: 収録曲がない`);
}
const videoIds = new Set();
for (const v of videos.values()) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(v.id)) err(`video ${v.slug}: 動画IDの形式が不正`);
  if (videoIds.has(v.id)) err(`video ${v.slug}: 動画IDが重複（${v.id}）`);
  videoIds.add(v.id);
  if (!recordings.has(v.recording)) err(`video ${v.slug}: 音源 ${v.recording} が存在しない`);
  if (!ENUM.videoKind.includes(v.kind ?? null)) err(`video ${v.slug}: kind が不正`);
  validDate(v.published, `video ${v.slug}`);
  if (v.image) for (const w of v.image.widths) if (!fileExists(`${v.image.base}-${w}.webp`)) err(`video ${v.slug}: 画像がない（${v.image.base}-${w}.webp）`);
}
keysOnly(catalog.home, ALLOWED.home, 'home');
const latest = videos.get([...videos.values()].find((v) => v.id === catalog.home.latestVideo)?.slug);
if (!latest) err(`home.latestVideo: 動画 ${catalog.home.latestVideo} が存在しない`);
else if (!latest.image || !latest.description) err('home.latestVideo: Homeに出す動画には image と description が必要');
const homeReleaseSlugs = catalog.home.releases || [];
if (new Set(homeReleaseSlugs).size !== homeReleaseSlugs.length) err('home.releases: 重複がある');
if (homeReleaseSlugs.length > 6) err('home.releases: Homeに載せるのは最大6件');
for (const s of homeReleaseSlugs) if (!releases.has(s)) err(`home.releases: ${s} が存在しない`);
for (const r of recordings.values()) {
  const used = [...releases.values()].some((rel) => rel.tracks.some((t) => t.recording === r.slug)) || [...videos.values()].some((v) => v.recording === r.slug);
  if (!used) err(`recording ${r.slug}: どのリリース・動画からも参照されていない`);
}

// 生成するページの範囲（試作中は一部の作品だけ）
const scope = (kind, all) => {
  const p = config.pages?.[kind];
  if (p === 'all') return new Set(all);
  if (!Array.isArray(p)) { err(`build.config.pages.${kind} は配列か "all"`); return new Set(); }
  for (const s of p) if (!all.includes(s)) err(`build.config.pages.${kind}: ${s} が存在しない`);
  return new Set(p);
};
const musicPages = scope('music', [...works.keys()]);
const releasePages = scope('releases', [...releases.keys()]);

if (errors.length) {
  console.error(`検査エラー ${errors.length} 件。ファイルは書き込んでいません。`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. 共通の部品
// ---------------------------------------------------------------------------
const BASE = catalog.site.baseUrl.replace(/\/$/, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TYPE_LABEL = { single: 'Single', ep: 'EP', album: 'Album', compilation: 'Compilation' };
const dots = (d) => d.replaceAll('-', '.');
const longDate = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return { ja: `${y}年${m}月${day}日`, en: `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${day}, ${y}` };
};
const duration = (ms) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const iso8601Duration = (ms) => `PT${Math.floor(Math.round(ms / 1000) / 60)}M${Math.round(ms / 1000) % 60}S`;
const musicUrl = (workSlug) => `/music/${workSlug}/`;
const releaseUrl = (slug) => `/releases/${slug}/`;
const ext = 'target="_blank" rel="noopener noreferrer"';

// 音源 → 収録枠（リリースの新しい順ではなく、配信日の古い順＝初出順）
const appearances = new Map();
for (const rel of [...releases.values()].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.slug.localeCompare(b.slug))) {
  for (const t of rel.tracks) {
    if (!appearances.has(t.recording)) appearances.set(t.recording, []);
    appearances.get(t.recording).push({ release: rel, track: t });
  }
}
// ページに出す動画は種別を確認したものだけ（kind が null の動画は出さない）
const videosOf = (recSlug) => [...videos.values()].filter((v) => v.recording === recSlug && v.kind).sort((a, b) => a.published.localeCompare(b.published));
const VIDEO_ACTION = { 'official-music-video': { full: 'MVを見る / Watch MV', short: 'MVを見る' }, audio: { full: 'YouTubeで聴く / Listen on YouTube', short: 'YouTubeで聴く' } };
const recTitle = (r) => r.title ?? works.get(r.work).title;
const recordingsOf = (workSlug) => [...recordings.values()].filter((r) => r.work === workSlug);
// 楽曲に関係する確認済みの日付（配信日・YouTube公開日）。並べ替えと年の絞り込みにだけ使い、「初出」としては表示しない
const datesOf = (workSlug) => recordingsOf(workSlug).flatMap((r) => [
  ...(appearances.get(r.slug) || []).map((a) => a.release.releaseDate),
  ...videosOf(r.slug).map((v) => v.published),
]).sort();
const coverOf = (workSlug) => {
  for (const r of recordingsOf(workSlug)) {
    const a = (appearances.get(r.slug) || [])[0];
    if (a) return { ...a.release.cover, alt: `${a.release.title}（${TYPE_LABEL[a.release.type]}）のジャケット`, square: true };
  }
  // 配信のない楽曲は、公開用に承認済みの動画画像があればそれを使う
  for (const r of recordingsOf(workSlug)) {
    const v = videosOf(r.slug).find((x) => x.image);
    if (v) return { ...v.image, square: false };
  }
  return null;
};
const artistSlugs = (displayArtist) => displayArtist.split(', ').map((name) => [...artists.values()].find((a) => a.name === name).slug);

// ---------------------------------------------------------------------------
// 3. Home の生成範囲（現行の表示と同じ HTML を出す）
// ---------------------------------------------------------------------------
function homeLatest(v) {
  const img = v.image;
  const srcset = img.widths.map((w) => `${img.base}-${w}.webp ${w}w`).join(', ');
  return [
    `    <article class="feature-card reveal" id="latest-${v.slug}">`,
    `      <img class="card-media feature-card__media" src="${img.base}-${img.src}.webp"`,
    `           srcset="${srcset}"`,
    `           sizes="(max-width: 768px) calc(100vw - 82px), (max-width: 817px) calc(100vw - 106px), 560px"`,
    `           width="${img.width}" height="${img.height}" loading="lazy" decoding="async" alt="${esc(img.alt)}">`,
    `      <div class="feature-card__body">`,
    `        <h3>${esc(v.title)}</h3>`,
    `        <p class="feature-card__subtitle">${esc(v.subtitle)}</p>`,
    `        <p>${esc(v.description.ja)}</p>`,
    `        <p class="en">${esc(v.description.en)}</p>`,
    `        <a href="https://youtu.be/${v.id}" class="button" ${ext}>YouTubeで見る / Watch on YouTube</a>`,
    `      </div>`,
    `    </article>`,
  ];
}

// load：'lazy'（既定・Home）／'eager'（画面の最初に見える）／'priority'（最初に見える中で最優先。LCP の対象）
// reveal：Home のスクロール表示の演出。子ページでは付けない（JS を待たずに描画するため）
function releaseCard(rel, { coverHref, coverLabel, pathPrefix, titleHref, heading = 'h3', load = 'lazy', reveal = true }) {
  const c = rel.cover;
  const type = TYPE_LABEL[rel.type];
  const external = /^https?:/.test(coverHref);
  return [
    `      <li class="release-card${reveal ? ' reveal' : ''}">`,
    `        <a class="release-cover" href="${esc(coverHref)}"${external ? ' ' + ext : ''}>`,
    `          <img src="${pathPrefix}${c.base}-320.webp"`,
    `               srcset="${pathPrefix}${c.base}-320.webp 320w, ${pathPrefix}${c.base}-480.webp 480w"`,
    `               sizes="(max-width: 767px) calc(50vw - 34px), 300px"`,
    `               width="480" height="480" ${load === 'priority' ? 'fetchpriority="high"' : load === 'eager' ? 'loading="eager"' : 'loading="lazy"'} decoding="async" alt="${esc(rel.title)}（${type}）${coverLabel}">`,
    `        </a>`,
    `        <p class="release-meta"><time datetime="${rel.releaseDate}">${dots(rel.releaseDate)}</time> ・ ${type}</p>`,
    titleHref ? `        <${heading}><a href="${titleHref}">${esc(rel.title)}</a></${heading}>` : `        <${heading}>${esc(rel.title)}</${heading}>`,
    `        <p class="release-artist">${esc(rel.displayArtist)}</p>`,
    `        <details>`,
    `          <summary>収録曲 ${rel.tracks.length} / Tracklist</summary>`,
    `          <ol>`,
    ...rel.tracks.map((t) => `              <li>${esc(recTitle(recordings.get(t.recording)))}</li>`),
    `          </ol>`,
    `        </details>`,
    `      </li>`,
  ];
}

function homeReleases(slugs) {
  return [
    `    <ol class="release-list">`,
    ...slugs.flatMap((s) => {
      const rel = releases.get(s);
      return releaseCard(rel, { coverHref: rel.links.spotify, coverLabel: 'をSpotifyで聴く', pathPrefix: '' });
    }),
    `    </ol>`,
  ];
}

function replaceRegion(html, name, lines) {
  const start = `<!-- generated:${name}`;
  const end = `<!-- /generated:${name} -->`;
  const rows = html.split('\n');
  const s = rows.findIndex((l) => l.includes(start));
  const e = rows.findIndex((l) => l.includes(end));
  if (s < 0 || e < 0 || e < s) throw new Error(`index.html に生成範囲「${name}」の目印がない`);
  return [...rows.slice(0, s + 1), ...lines, ...rows.slice(e)].join('\n');
}

// ---------------------------------------------------------------------------
// 4. 子ページの共通の枠
// ---------------------------------------------------------------------------
// メインメニュー（Home と子ページで共通。Home はページ内リンク、子ページは Home の各見出しへのリンク）
// Music だけは別ページ（/music/）へのリンク
const NAV = [
  ['concept', 'Concept / コンセプト'], ['characters', 'Characters / キャラクター'], ['works', 'Works / 作品'],
  ['latest', 'Latest / 最新動画'], ['releases', 'Releases / 配信作品'], ['music', 'Music / 楽曲', 'music/'], ['social', 'Social / SNS'],
];
function navItems({ home, current }) {
  return NAV.map(([id, label, pageHref]) => {
    const href = pageHref ? (home ? pageHref : '/' + pageHref) : (home ? `#${id}` : `/#${id}`);
    // 今いるページ（または、その下の詳細ページ）のメニュー項目に印を付ける
    const cur = current === id ? ' aria-current="page"' : current === id + '/*' ? ' aria-current="true"' : '';
    return `        <li><a href="${href}"${cur}>${label}</a></li>`;
  });
}

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&amp;family=Inter:wght@400;500;600&amp;display=swap';
function page({ path, title, description, og, crumbs, body, scripts = [], jsonLd, nav, notFound = false }) {
  const url = BASE + path;
  const image = og?.image;
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="ja">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${esc(title)}</title>`,
    `  <meta name="description" content="${esc(description)}">`,
    ...(notFound ? ['  <meta name="robots" content="noindex">']
      : PREVIEW ? ['  <!-- 試作中：検索エンジンに登録しない（本番用の出力では付けない） -->', '  <meta name="robots" content="noindex">'] : []),
    ...(notFound ? [] : [
      `  <link rel="canonical" href="${url}">`,
      '',
      '  <!-- OGP（SNSでURLを共有したときのカード表示） -->',
      `  <meta property="og:type" content="${og.type}">`,
      `  <meta property="og:site_name" content="${esc(catalog.site.name)}">`,
      `  <meta property="og:url" content="${url}">`,
      `  <meta property="og:title" content="${esc(title)}">`,
      `  <meta property="og:description" content="${esc(description)}">`,
      `  <meta property="og:image" content="${BASE}/${image.path}">`,
      `  <meta property="og:image:width" content="${image.width}">`,
      `  <meta property="og:image:height" content="${image.height}">`,
      `  <meta property="og:image:alt" content="${esc(image.alt)}">`,
      `  <meta name="twitter:card" content="${og.card}">`,
    ]),
    '',
    '  <link rel="icon" href="/images/favicon.svg" type="image/svg+xml">',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    // 子ページでは Web フォントの CSS を描画を止めずに読み込む（届くまでは代替フォントで表示。LCP 改善のため。Home は従来どおり）
    `  <link rel="preload" href="${FONT_CSS}" as="style" onload="this.onload=null;this.rel='stylesheet'">`,
    `  <noscript><link rel="stylesheet" href="${FONT_CSS}"></noscript>`,
    '  <link rel="stylesheet" href="/css/style.css">',
    '  <link rel="stylesheet" href="/css/pages.css">',
    '  <script>',
    "    document.documentElement.classList.add('js-nav-ready', 'js');",
    "    window.addEventListener('load', function () {",
    '      if (!window.zunaariNavReady) {',
    "        document.documentElement.classList.remove('js-nav-ready');",
    '      }',
    '    });',
    '  </script>',
    ...(jsonLd ? ['  <script type="application/ld+json">', '  ' + JSON.stringify(jsonLd), '  </script>'] : []),
    '</head>',
    '<body class="subpage">',
    '',
    '  <a class="skip-link" href="#main">本文へスキップ / Skip to content</a>',
    '',
    '  <header id="header">',
    '    <a href="/" class="logo">zunaari music</a>',
    '    <button type="button" class="menu-toggle" aria-expanded="false" aria-controls="site-nav" aria-label="メニューを開く">',
    '      <span class="menu-toggle__icon" aria-hidden="true"></span>',
    '    </button>',
    '    <nav id="site-nav" aria-label="メインメニュー">',
    '      <ul>',
    ...navItems({ home: false, current: nav }),
    '      </ul>',
    '    </nav>',
    '  </header>',
    '',
    '  <main id="main" tabindex="-1">',
    '',
    ...(crumbs ? [
      '  <nav class="breadcrumb" aria-label="パンくずリスト">',
      '    <ol>',
      ...crumbs.map(([label, href], i) => (i === crumbs.length - 1
        ? `      <li><span aria-current="page">${esc(label)}</span></li>`
        : `      <li><a href="${href}">${esc(label)}</a></li>`)),
      '    </ol>',
      '  </nav>',
      '',
    ] : []),
    ...body,
    '',
    '  </main>',
    '',
    '  <footer id="footer">',
    '    <p>&copy; 2026 zunaari music. All rights reserved.</p>',
    '  </footer>',
    '',
    '  <script src="/js/main.js" defer></script>',
    ...scripts.map((s) => `  <script src="${s}" defer></script>`),
    '</body>',
    '</html>',
    '',
  ];
  return lines.join('\n');
}
const GENERATED_NOTE = '<!-- このページは _build/build.mjs が _src/data/catalog.json から生成しています。直接編集しないでください。 -->';
const withNote = (html) => html.replace('<head>', `<head>\n  ${GENERATED_NOTE}`);
const defaultOg = { type: 'website', card: 'summary_large_image', image: catalog.site.defaultOgImage };
const coverOg = (cover, type) => (OG_IMAGE === 'common' ? { ...defaultOg, type } : { type, card: 'summary', image: { path: `${cover.base}-480.webp`, width: 480, height: 480, alt: cover.alt } });

// ---------------------------------------------------------------------------
// 5. 各ページ
// ---------------------------------------------------------------------------
const listenLinks = (items) => items.length
  ? ['        <ul class="listen-links">', ...items.map(([href, label]) => `          <li><a class="button" href="${esc(href)}" ${ext}>${label}</a></li>`), '        </ul>']
  : [];

const coverImg = (cover) => {
  if (cover.square) {
    return `      <img class="detail__cover" src="/${cover.base}-480.webp" srcset="/${cover.base}-320.webp 320w, /${cover.base}-480.webp 480w" sizes="(max-width: 767px) calc(100vw - 2.5rem), 360px" width="480" height="480" fetchpriority="high" decoding="async" alt="${esc(cover.alt)}">`;
  }
  return `      <img class="detail__cover detail__cover--wide" src="/${cover.base}-${cover.src}.webp" srcset="${cover.widths.map((w) => `/${cover.base}-${w}.webp ${w}w`).join(', ')}" sizes="(max-width: 767px) calc(100vw - 2.5rem), 360px" width="${cover.width}" height="${cover.height}" fetchpriority="high" decoding="async" alt="${esc(cover.alt)}">`;
};
const wideOg = (img, type) => {
  if (OG_IMAGE === 'common') return { ...defaultOg, type };
  const w = Math.max(...img.widths);
  return { type, card: 'summary_large_image', image: { path: `${img.base}-${w}.webp`, width: w, height: Math.round((w * img.height) / img.width), alt: img.alt } };
};

function musicDetail(work) {
  const recs = recordingsOf(work.slug);
  const cover = coverOf(work.slug);
  const artistsShown = [...new Set(recs.map((r) => r.displayArtist))].join(' / ');
  const allApps = recs.flatMap((r) => appearances.get(r.slug) || []);
  const allVideos = recs.flatMap((r) => videosOf(r.slug));
  // 先頭のボタン：音源が1つなら曲のURL、複数（Chapter など）なら最初の収録作品のURL
  const heroSpotify = recs.length === 1 ? allApps[0]?.track.links?.spotify : allApps[0]?.release.links?.spotify;
  const heroVideo = recs.length === 1 ? allVideos[0] : null;
  const relTitles = [...new Set(allApps.map((a) => `${a.release.title} (${TYPE_LABEL[a.release.type]})`))];
  const hasMv = allVideos.some((v) => v.kind === 'official-music-video');
  const description = `${work.title} by ${artistsShown}.${relTitles.length ? ` Appears on ${relTitles.join(', ')}.` : ''}${hasMv ? ' Official music video on YouTube.' : ''}`
    + ` / ${work.title}（${artistsShown}）の楽曲ページ。${relTitles.length ? '収録作品と配信日、' : ''}${allVideos.length ? 'YouTubeの公開日とリンク。' : '配信リンク。'}`;
  const recBlocks = recs.flatMap((r) => {
    const apps = appearances.get(r.slug) || [];
    const vids = videosOf(r.slug);
    const name = esc(recTitle(r));
    return [
      `      <li class="recording" id="${r.slug}">`,
      `        <h3>${name}${r.versionLabel ? ` <span class="recording__version">${esc(r.versionLabel)}</span>` : ''}</h3>`,
      `        <p class="recording__meta">${esc(r.displayArtist)}${r.durationMs ? ` ・ <time datetime="${iso8601Duration(r.durationMs)}">${duration(r.durationMs)}</time>` : ''}</p>`,
      ...(apps.length ? [
        `        <p class="recording__label">収録 / Appears on（${apps.length}）</p>`,
        '        <ul class="appearances">',
        ...apps.map(({ release: rel, track: t }) => {
          const relLink = releasePages.has(rel.slug) ? `<a href="${releaseUrl(rel.slug)}">${esc(rel.title)}</a>` : esc(rel.title);
          const sp = t.links?.spotify ? ` <a class="appearances__listen" href="${esc(t.links.spotify)}" ${ext}>Spotifyで聴く<span class="visually-hidden">（「${esc(rel.title)}」収録の${name}）</span></a>` : '';
          return `          <li>${relLink} <span class="appearances__meta">${TYPE_LABEL[rel.type]} ・ 配信日 <time datetime="${rel.releaseDate}">${dots(rel.releaseDate)}</time> ・ Track ${t.no}</span>${sp}</li>`;
        }),
        '        </ul>',
      ] : []),
      ...(vids.length ? [
        '        <p class="recording__label">YouTube</p>',
        '        <ul class="appearances">',
        ...vids.map((v) => `          <li>${esc(v.title)} <span class="appearances__meta">${v.kind === 'official-music-video' ? 'Official MV' : '音源 / Audio'} ・ YouTube公開日 <time datetime="${v.published}">${dots(v.published)}</time></span> <a class="appearances__listen" href="https://youtu.be/${v.id}" ${ext}>${VIDEO_ACTION[v.kind].short}<span class="visually-hidden">（${esc(v.title)}）</span></a></li>`),
        '        </ul>',
      ] : []),
      '      </li>',
    ];
  });
  const body = [
    '  <article class="detail">',
    `    <div class="detail__hero${cover ? '' : ' detail__hero--text'}">`,
    ...(cover ? [coverImg(cover)] : []),
    '      <div class="detail__body">',
    '        <p class="detail__kicker">Music / 楽曲</p>',
    `        <h1>${esc(work.title)}</h1>`,
    `        <p class="detail__artist">${esc(artistsShown)}</p>`,
    ...(recs.length > 1 ? [`        <p class="detail__facts">音源 ${recs.length} / ${recs.length} recordings</p>`] : []),
    ...listenLinks([
      ...(heroSpotify ? [[heroSpotify, 'Spotifyで聴く / Listen on Spotify']] : []),
      ...(heroVideo ? [[`https://youtu.be/${heroVideo.id}`, VIDEO_ACTION[heroVideo.kind].full]] : []),
    ]),
    '      </div>',
    '    </div>',
    '',
    '    <section class="detail__section" aria-labelledby="recordings-heading">',
    '      <h2 id="recordings-heading">音源と収録 / Recordings</h2>',
    '      <ul class="recording-list">',
    ...recBlocks,
    '      </ul>',
    '    </section>',
    '',
    '    <p class="detail__back"><a href="/music/">← Music Library / 楽曲一覧</a></p>',
    '  </article>',
  ];
  return withNote(page({
    path: musicUrl(work.slug),
    title: `${work.title} | Music | zunaari music`,
    description,
    og: !cover ? { ...defaultOg, type: 'music.song' } : cover.square ? coverOg(cover, 'music.song') : wideOg(cover, 'music.song'),
    crumbs: [['Home', '/'], ['Music', '/music/'], [work.title]],
    nav: 'music/*',
    body,
  }));
}

function releaseDetail(rel) {
  const type = TYPE_LABEL[rel.type];
  const d = longDate(rel.releaseDate);
  const cover = { ...rel.cover, alt: `${rel.title}（${type}）のジャケット` };
  const description = `${rel.title} — ${type} by ${rel.displayArtist}, released ${d.en}. ${rel.tracks.length} track${rel.tracks.length > 1 ? 's' : ''}. / ${rel.displayArtist}の${type}（${d.ja}配信）。収録曲と配信リンク。`;
  const total = rel.tracks.reduce((s, t) => s + (recordings.get(t.recording).durationMs || 0), 0);
  const body = [
    '  <article class="detail">',
    '    <div class="detail__hero">',
    `      <img class="detail__cover" src="/${cover.base}-480.webp" srcset="/${cover.base}-320.webp 320w, /${cover.base}-480.webp 480w" sizes="(max-width: 767px) calc(100vw - 2.5rem), 360px" width="480" height="480" fetchpriority="high" decoding="async" alt="${esc(cover.alt)}">`,
    '      <div class="detail__body">',
    `        <p class="detail__kicker">Release / 配信作品 ・ ${type}</p>`,
    `        <h1>${esc(rel.title)}</h1>`,
    `        <p class="detail__artist">${esc(rel.displayArtist)}</p>`,
    `        <p class="detail__facts">配信日 / Released <time datetime="${rel.releaseDate}">${dots(rel.releaseDate)}</time> ・ 収録曲 ${rel.tracks.length} / ${rel.tracks.length} track${rel.tracks.length > 1 ? 's' : ''}${total ? ` ・ ${duration(total)}` : ''}</p>`,
    ...listenLinks([[rel.links.spotify, 'Spotifyで聴く / Listen on Spotify']]),
    '      </div>',
    '    </div>',
    '',
    '    <section class="detail__section" aria-labelledby="tracklist-heading">',
    '      <h2 id="tracklist-heading">収録曲 / Tracklist</h2>',
    '      <ol class="tracklist">',
    ...rel.tracks.map((t) => {
      const r = recordings.get(t.recording);
      const name = musicPages.has(r.work) ? `<a href="${musicUrl(r.work)}#${r.slug}">${esc(recTitle(r))}</a>` : esc(recTitle(r));
      return `        <li><span class="tracklist__no">${t.no}</span><span class="tracklist__title">${name}</span>${r.durationMs ? `<time class="tracklist__time" datetime="${iso8601Duration(r.durationMs)}">${duration(r.durationMs)}</time>` : ''}</li>`;
    }),
    '      </ol>',
    '    </section>',
    '',
    '    <p class="detail__back"><a href="/releases/">← Releases / 配信作品一覧</a></p>',
    '  </article>',
  ];
  return withNote(page({
    path: releaseUrl(rel.slug),
    title: `${rel.title} (${type}) | Releases | zunaari music`,
    description,
    og: coverOg(cover, 'music.album'),
    crumbs: [['Home', '/'], ['Releases', '/releases/'], [rel.title]],
    body,
  }));
}

function musicIndex() {
  // 1楽曲1行。配信日・YouTube公開日のうち最も早い日付の新しい順（日付は並べ替えにだけ使う）、同日は slug 順
  const items = [...musicPages].map((s) => works.get(s)).map((w) => ({ w, dates: datesOf(w.slug) }))
    .sort((a, b) => b.dates[0].localeCompare(a.dates[0]) || a.w.slug.localeCompare(b.w.slug));
  // 絞り込みは確認済みの分類だけ。データに値がない分類（ジャンル・シリーズ・歌唱言語など）は表示しない
  const facetValues = { artist: new Set(), format: new Set(), year: new Set(), genre: new Set(), series: new Set(), lang: new Set() };
  const LANG_LABEL = { ja: '日本語 / Japanese', en: '英語 / English', mixed: '日英 / Japanese & English', instrumental: 'インスト / Instrumental' };
  const FORMAT_LABEL = { streaming: '配信 / Streaming', youtube: 'YouTube' };
  const rows = items.map(({ w, dates }) => {
    const recs = recordingsOf(w.slug);
    const artistList = [...new Set(recs.flatMap((r) => artistSlugs(r.displayArtist)))];
    const apps = recs.flatMap((r) => appearances.get(r.slug) || []);
    const vids = recs.flatMap((r) => videosOf(r.slug));
    const formats = [...(apps.length ? ['streaming'] : []), ...(vids.length ? ['youtube'] : [])];
    const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
    const langs = [...new Set(recs.map((r) => r.lyricsType).filter(Boolean))];
    artistList.forEach((a) => facetValues.artist.add(a));
    formats.forEach((f) => facetValues.format.add(f));
    years.forEach((y) => facetValues.year.add(y));
    (w.genres || []).forEach((g) => facetValues.genre.add(g));
    (w.series || []).forEach((g) => facetValues.series.add(g));
    langs.forEach((l) => facetValues.lang.add(l));
    const artistsShown = [...new Set(recs.map((r) => r.displayArtist))].join(' / ');
    const rels = [...new Set(apps.map((a) => a.release.title))];
    const search = [w.title, ...recs.map((r) => recTitle(r)), ...recs.map((r) => r.versionLabel).filter(Boolean), artistsShown, ...rels, ...vids.map((v) => v.title)].join(' ').toLowerCase();
    const where = [...(rels.length ? [rels.map(esc).join(' / ')] : []), ...(vids.length ? [vids.some((v) => v.kind === 'official-music-video') ? 'YouTube（MV）' : 'YouTube'] : [])];
    return [
      `      <li class="library-item" data-search="${esc(search)}" data-artist="${artistList.join(' ')}" data-format="${formats.join(' ')}" data-year="${years.join(' ')}" data-genre="${(w.genres || []).join(' ')}" data-series="${(w.series || []).join(' ')}" data-lang="${langs.join(' ')}">`,
      `        <a class="library-item__title" href="${musicUrl(w.slug)}">${esc(w.title)}</a>`,
      `        <span class="library-item__artist">${esc(artistsShown)}</span>`,
      `        <span class="library-item__meta">${where.join(' ・ ')}${recs.length > 1 ? ` ・ 音源 ${recs.length}` : ''}</span>`,
      '      </li>',
    ];
  });
  const artistOrder = [...artists.keys()];
  const select = (key, label, values, fmt, order) => values.size ? [
    '        <div class="library-filter__field">',
    `          <label for="filter-${key}">${label}</label>`,
    `          <select id="filter-${key}" name="${key}">`,
    '            <option value="">すべて / All</option>',
    ...[...values].sort(order).map((v) => `            <option value="${esc(v)}">${esc(fmt(v))}</option>`),
    '          </select>',
    '        </div>',
  ] : [];
  const byText = (a, b) => a.localeCompare(b);
  const body = [
    '  <section class="page-section" aria-labelledby="page-title">',
    '    <h1 id="page-title">Music Library / 楽曲</h1>',
    '    <p>公開中の楽曲の一覧です。曲名・名義・収録作品で検索できます。</p>',
    '    <p class="en">All published works. Search by title, artist or release.</p>',
    '',
    '    <form class="library-filter" role="search" aria-label="楽曲を探す">',
    '      <div class="library-filter__field library-filter__field--search">',
    '        <label for="filter-q">検索 / Search</label>',
    '        <div class="library-filter__search">',
    '          <input id="filter-q" name="q" type="search" autocomplete="off" placeholder="曲名・名義・収録作品 / Title, artist or release">',
    '          <button type="submit" class="library-filter__submit">検索 / Search</button>',
    '        </div>',
    '      </div>',
    ...select('artist', '名義 / Artist', facetValues.artist, (v) => artists.get(v).name, (a, b) => artistOrder.indexOf(a) - artistOrder.indexOf(b)),
    ...select('format', '形態 / Format', facetValues.format, (v) => FORMAT_LABEL[v], (a, b) => Object.keys(FORMAT_LABEL).indexOf(a) - Object.keys(FORMAT_LABEL).indexOf(b)),
    ...select('genre', 'ジャンル / Genre', facetValues.genre, (v) => v, byText),
    ...select('series', 'シリーズ / Series', facetValues.series, (v) => v, byText),
    ...select('lang', '歌唱言語 / Language', facetValues.lang, (v) => LANG_LABEL[v], byText),
    ...select('year', '年 / Year', facetValues.year, (v) => v, (a, b) => b.localeCompare(a)),
    '      <div class="library-filter__status">',
    `        <p class="library-filter__count" aria-live="polite"><span data-count>${items.length}</span> 件 / items</p>`,
    '        <button type="reset" class="library-filter__clear">条件をクリア / Clear</button>',
    '      </div>',
    '    </form>',
    '',
    '    <ul class="library-list">',
    ...rows.flat(),
    '    </ul>',
    '    <p class="library-empty" hidden>条件に合う楽曲はありません。条件を変えるか、クリアしてください。<br><span class="en">No works match. Change or clear the filters.</span></p>',
    '',
    '    <p class="page-links"><a href="/releases/">配信作品の一覧へ / All releases →</a></p>',
    '  </section>',
  ];
  return withNote(page({
    path: '/music/',
    title: 'Music Library | zunaari music',
    description: 'Music Library of zunaari music. Find works by title, artist and release. / zunaari music の楽曲一覧。',
    og: defaultOg,
    crumbs: [['Home', '/'], ['Music']],
    nav: 'music',
    body,
    scripts: ['/js/library.js'],
  }));
}

function releasesIndex() {
  const list = [...releasePages].map((s) => releases.get(s)).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.slug.localeCompare(b.slug));
  const body = [
    '  <section class="page-section" aria-labelledby="page-title">',
    '    <h1 id="page-title">Releases / 配信作品</h1>',
    '    <p>音楽配信サービスで配信中のシングル・EP・アルバム。</p>',
    '    <p class="en">Singles, EPs and albums on streaming services.</p>',
    '    <ol class="release-list">',
    ...list.flatMap((rel, i) => releaseCard(rel, { coverHref: releaseUrl(rel.slug), coverLabel: 'の詳細', pathPrefix: '/', titleHref: releaseUrl(rel.slug), heading: 'h2', load: i === 0 ? 'priority' : i < 3 ? 'eager' : 'lazy', reveal: false })),
    '    </ol>',
    '    <p class="page-links"><a href="/music/">楽曲の一覧へ / Music Library →</a></p>',
    '  </section>',
  ];
  return withNote(page({
    path: '/releases/',
    title: 'Releases | zunaari music',
    description: 'Singles, EPs and albums by zunaari music on streaming services. / zunaari music の配信作品一覧。',
    og: defaultOg,
    crumbs: [['Home', '/'], ['Releases']],
    body,
  }));
}

// 存在しないURLで表示するページ（GitHub Pages は階層に関係なくルートの 404.html を返すので、リンクはすべてルートから書く）
function notFoundPage() {
  const body = [
    '  <section class="page-section not-found" aria-labelledby="page-title">',
    '    <h1 id="page-title">Page not found / ページが見つかりません</h1>',
    '    <p>お探しのページは見つかりませんでした。URLが変わったか、削除された可能性があります。</p>',
    '    <p class="en">The page you are looking for could not be found. It may have moved or been removed.</p>',
    '    <ul class="not-found__links">',
    '      <li><a class="button" href="/">Home / ホーム</a></li>',
    '      <li><a class="button" href="/music/">Music Library / 楽曲</a></li>',
    '      <li><a class="button" href="/releases/">Releases / 配信作品</a></li>',
    '    </ul>',
    '  </section>',
  ];
  return withNote(page({
    path: '/404.html',
    title: 'Page not found | zunaari music',
    description: 'The page could not be found. / ページが見つかりません。',
    notFound: true,
    body,
  }));
}

// 検索エンジン向け：登録してよいページ（noindex でないページ）だけを sitemap に載せる
function sitemap(paths) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((p) => `  <url><loc>${esc(BASE + p)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
const robots = () => ['User-agent: *', 'Allow: /', '', `Sitemap: ${BASE}/sitemap.xml`, ''].join('\n');

// ---------------------------------------------------------------------------
// 6. 出力
// ---------------------------------------------------------------------------
const outputs = new Map();
{
  const path = join(ROOT, 'index.html');
  let html = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  html = replaceRegion(html, 'home-latest', homeLatest(latest));
  html = replaceRegion(html, 'home-releases', homeReleases(homeReleaseSlugs));
  html = replaceRegion(html, 'site-nav', navItems({ home: true }));
  outputs.set('index.html', html);
}
for (const s of musicPages) outputs.set(`music/${s}/index.html`, musicDetail(works.get(s)));
for (const s of releasePages) outputs.set(`releases/${s}/index.html`, releaseDetail(releases.get(s)));
outputs.set('music/index.html', musicIndex());
outputs.set('releases/index.html', releasesIndex());
outputs.set('404.html', notFoundPage());
// sitemap の順：Home、楽曲一覧、楽曲（一覧と同じ順）、配信作品一覧、配信作品（新しい順）
const indexable = PREVIEW ? ['/'] : ['/', '/music/', ...[...musicPages].map((s) => ({ s, d: datesOf(s)[0] })).sort((a, b) => b.d.localeCompare(a.d) || a.s.localeCompare(b.s)).map(({ s }) => musicUrl(s)),
  '/releases/', ...[...releasePages].map((s) => releases.get(s)).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.slug.localeCompare(b.slug)).map((r) => releaseUrl(r.slug))];
outputs.set('sitemap.xml', sitemap(indexable));
outputs.set('robots.txt', robots());

// 範囲外になった古い生成ページがあれば知らせる（自動では削除しない）
const stale = [];
for (const dir of ['music', 'releases']) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) continue;
  for (const name of readdirSync(d)) {
    const p = `${dir}/${name}/index.html`;
    if (statSync(join(d, name)).isDirectory() && existsSync(join(ROOT, p)) && !outputs.has(p)) stale.push(p);
  }
}

const normalize = (s) => s.replace(/\r\n/g, '\n');
let changed = 0;
const diffs = [];
for (const [rel, content] of outputs) {
  const p = join(ROOT, rel);
  const current = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (current !== null && normalize(current) === content) continue;
  changed++;
  diffs.push(rel);
  if (!CHECK) {
    mkdirSync(dirname(p), { recursive: true });
    const eol = current && current.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(p, eol === '\n' ? content : content.replace(/\n/g, '\r\n'));
  }
}

if (CHECK) {
  if (changed || stale.length) {
    console.error(`生成結果と一致しないファイル ${changed} 件${stale.length ? `、範囲外の古い生成ページ ${stale.length} 件` : ''}`);
    for (const d of diffs) console.error('  - ' + d);
    for (const s of stale) console.error('  - 古い生成ページ: ' + s);
    process.exit(1);
  }
  console.log(`OK：生成結果とファイルが一致（${outputs.size} ファイル）`);
} else {
  console.log(`検査OK。${outputs.size} ファイルを生成（変更 ${changed} 件）`);
  for (const d of diffs) console.log('  - ' + d);
  if (stale.length) {
    console.warn('範囲外の古い生成ページ（必要なら手動で削除）:');
    for (const s of stale) console.warn('  - ' + s);
  }
}
