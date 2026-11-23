# drawio-mjs

**Pure Node.js (`.mjs`) draw.io XML → PNG / SVG Generator**

> **Disclaimer**: This is an independent, unofficial open-source project and is **not** affiliated with, endorsed by, or sponsored by draw.io Ltd (JGraph) or draw.io AG. `draw.io` is a registered trademark of draw.io AG.

[jgraph/drawio](https://github.com/jgraph/drawio)（v29.6.6）および [jgraph/drawio-desktop](https://github.com/jgraph/drawio-desktop) の OSS コード（`mxGraph` / `mxShape` / `mxStencil` / `mxStencilRegistry` / `mxEdgeStyle` / `mxPerimeter` / `writePngWithText`）をベースに、**ブラウザ（Electron / Playwright / Puppeteer）を一切使わず Node.js (`.mjs`) だけで完結する** draw.io XML → PNG / SVG ジェネレーターです。

---

## 特徴

1. **ブラウザ不要・Pure Node.js (`.mjs`) 完結**
   - draw.io OSS の純粋JS図形定義（**772種類**のJSシェイプクラス）とステンシル定義（**202パッケージ・10,000種類以上**の `mxgraph.*` XMLステンシル）を内蔵し、`SvgCanvas2D`（`mxAbstractCanvas2D` 互換）で直接 SVG を生成して `@resvg/resvg-js` で高速に PNG 化します。
2. **全図形・ステンシル対応**
   - 基本図形（矩形・角丸・ひし形・楕円・シリンダー `cylinder3`・クラウド・UMLアクター・平行四辺形・六角形・ステップ・ドキュメント・ノート・吹き出し `callout` 等）
   - 複合図形（コンテナ・グループ・スイムレーン `swimlane`・テーブル `table` / `tableRow` / `tableCell`）
   - クラウド・アーキテクチャアイコン（`mxgraph.aws4.*`, `mxgraph.gcp2.*`, `mxgraph.azure.*`, `mxgraph.kubernetes.*`, `mxgraph.flowchart.*`, `mxgraph.basic.*`, `mxgraph.bpmn.*`, `mxgraph.c4.*`, `mxgraph.uml25.*`, `mxgraph.er.*` 等）
   - コネクタ・ルーティング（直交 `orthogonalEdgeStyle`、エルボー `elbowEdgeStyle`、ER図 `entityRelationEdgeStyle`、角丸 `rounded=1`、各種矢印マーカー `classic`, `block`, `open`, `diamond`, `ERmany`, `ERmandOne` 等）
3. **HTMLラベル & 日本語（全角/半角）自動折り返し**
   - `<foreignObject>` を使わず、`<b>`, `<i>`, `<u>`, `<s>`, `<br>`, `<div>`, `<font>`, `<span style="...">`, リスト等の HTML ラベルを解析し、日本語（東アジア文字幅）対応のワードラップ計算を行って純粋な SVG `<text>` / `<tspan>` として描画します。
4. **圧縮済み `.drawio` & マルチページ対応**
   - `<diagram>` 内の raw Deflate + Base64 + URI エンコード済み圧縮 XML を自動展開します。
5. **draw.io 再編集可能な PNG 出力（`zTXt` チャンク XML 埋め込み）**
   - draw.io OSS の `writePngWithText` を `.mjs` に移植し、出力 PNG の `zTXt` チャンク（キー: `mxGraphModel`）に元 XML を圧縮埋め込みします。生成された `.drawio.png` をそのまま draw.io にドラッグ＆ドロップして再編集できます。

---

## セットアップ

```bash
git clone https://github.com/NagasakaH/drawio-mjs.git
cd drawio-mjs
npm install
```

---

## CLI の使い方

```bash
# 基本変換 (.drawio / .xml -> .png)
node bin/drawio2png.mjs input.drawio -o output.drawio.png

# 倍率(scale)・余白(border)・背景透過(transparent)・DPI指定
node bin/drawio2png.mjs input.drawio -o output.drawio.png --scale 2 --border 16 --transparent --dpi 144

# ダークテーマで出力
node bin/drawio2png.mjs input.drawio -o output-dark.png --theme dark

# ページ番号（1始まり）またはページ名を指定して出力
node bin/drawio2png.mjs multi.drawio -o page2.png --page 2
node bin/drawio2png.mjs multi.drawio --all-pages

# SVG形式で出力
node bin/drawio2png.mjs input.drawio -o output.svg --format svg

# 生成した .drawio.png から埋め込み XML を抽出
node bin/drawio2png.mjs output.drawio.png --extract-xml
```

---

## `.mjs` モジュールとしての使い方

```js
import fs from "node:fs/promises";
import {
  convertXmlToPng,
  convertXmlToSvg,
  convertDrawioFile,
  extractDrawioXmlFromPng,
} from "./src/index.mjs";

// 1. XML文字列（またはBuffer）からPNG Bufferを生成
const xml = await fs.readFile("./examples/output/cloud-architecture.drawio", "utf8");
const { png, svg, width, height, pageName } = convertXmlToPng(xml, {
  scale: 2,          // 解像度倍率 (デフォルト: 2)
  border: 16,        // 余白ピクセル (デフォルト: 10)
  transparent: false,// 背景透過 (デフォルト: false)
  background: "#ffffff",
  theme: "light",    // "light" | "dark"
  page: 1,           // ページ番号(1始まり) または ページ名 / ID
  embedXml: true,    // PNGのzTXtチャンクにXMLを埋め込む (デフォルト: true)
  dpi: 144,          // pHYsチャンクにDPIを埋め込む
});

await fs.writeFile("./out.drawio.png", png);

// 2. .drawio.png から埋め込まれた draw.io XML を取り出す
const embeddedXml = extractDrawioXmlFromPng(png);
```

---

## ディレクトリ構成

- [`src/index.mjs`](src/index.mjs) - パブリック ESM API (`convertXmlToPng`, `convertXmlToSvg`, `convertDrawioFile`)
- [`src/xml.mjs`](src/xml.mjs) - Pure `.mjs` XML DOM パーサー & `.drawio` Deflate+Base64 展開器
- [`src/png-meta.mjs`](src/png-meta.mjs) - draw.io OSS `writePngWithText` / `readPngXml` 移植（`zTXt` / `tEXt` / `pHYs` チャンク読み書き + CRC32）
- [`src/html-text.mjs`](src/html-text.mjs) - HTML リッチテキスト解析 & 日本語ワードラップ対応 SVG `<text>` / `<tspan>` レイアウトエンジン
- [`src/oss-runtime.mjs`](src/oss-runtime.mjs) - draw.io OSS シェイプ・ステンシル実行ランタイム & `SvgCanvas2D` (`mxAbstractCanvas2D` 実装)
- [`src/renderer.mjs`](src/renderer.mjs) - `mxGraphModel` 状態検証・座標解決・エッジルーティング・SVG レンダラー
- [`bin/drawio2png.mjs`](bin/drawio2png.mjs) - CLI エントリポイント
- [`vendor/drawio-oss/`](vendor/drawio-oss/) - draw.io OSS (v29.6.6) から抽出した純粋JSシェイプ・ステンシル・スタイル定義およびライセンス文書
- [`test/drawio2png.test.mjs`](test/drawio2png.test.mjs) - 自動テストスイート (`npm test`)
- [`examples/generate-demos.mjs`](examples/generate-demos.mjs) - サンプル図生成スクリプト (`npm run demo`)

---

## ライセンス・引用元・再配布時の注意事項

本プロジェクトをフォーク・再配布・パッケージ公開する際は、以下のライセンス条項と制限事項を遵守してください。

### 1. ソースコードのライセンスと引用元（Apache License 2.0）
- 本リポジトリのコードおよび同梱されている draw.io コアエンジン部分（`vendor/drawio-oss/drawio-shapes-bundle.js`, `default-style.xml`, `dark-default-style.xml` 等）は **[Apache License 2.0](LICENSE)** の下で提供されています。
- **引用元（Upstream）**:
  - [jgraph/drawio](https://github.com/jgraph/drawio) (v29.6.6) — `Copyright (c) 2006-2025, JGraph Holdings Ltd (draw.io Ltd)` / `Copyright (c) 2006-2025, draw.io AG`
  - [jgraph/drawio-desktop](https://github.com/jgraph/drawio-desktop) — `Copyright (c) 2017-2025, JGraph Holdings Ltd` / `draw.io AG`
- **Apache License 2.0 に基づく再配布時の義務**:
  - 再配布物には必ず [`LICENSE`](LICENSE) および [`NOTICE`](NOTICE) ファイルを同梱してください。
  - 改変したファイルには改変した旨の明記（変更履歴やコメント）を保持してください。

### 2. アイコン・ステンシルライブラリに関する追加制限（Atlassian 製品への組み込み禁止）
draw.io OSS の `stencils/LICENSE` および `shapes/LICENSE`（本リポジトリの [`vendor/drawio-oss/LICENSE-STENCILS`](vendor/drawio-oss/LICENSE-STENCILS)）により、同梱されているアイコン・ステンシルデータ（`vendor/drawio-oss/stencils-map.json` および `drawio-shapes-bundle.js` 内のカスタムシェイプ）には以下の制限が課されています。

> The icon sets and stencil libraries included in this software, and any derivatives thereof (including conversions to other formats, traced reproductions, substantially similar visual representations, or AI-generated images created using these icons as reference or training input), may not be used as software assets in, distributed for use with, or incorporated into Atlassian products or products distributed through the Atlassian marketplace or plugin ecosystem, without explicit written permission.
>
> This restriction does not apply to end-user diagram output (such as exported images or documents) created using this software.

- **要点**:
  - **Atlassian 製品（Confluence / Jira 等）や Atlassian Marketplace プラグイン・エコシステム向けのソフトウェアアセットとしてこれらのステンシル・アイコンを組み込むこと・配布することは禁止**されています（書面による明示的な許諾がある場合を除く）。
  - **本ツールを使って出力した画像（PNG / SVG 等のエンドユーザー作成の図面）の利用にはこの制限は適用されません**（出力画像は自由に利用・配布可能です）。

### 3. 商標（Trademarks）およびサードパーティアイコンに関する注意事項
- **draw.io の商標**:
  - `draw.io` は draw.io AG の登録商標（EU商標 #018062448）です。
  - 公式プロダクトと誤認させるような名称・ロゴの使用や、draw.io Ltd / draw.io AG からの公認・提携を示唆する表記は行わないでください。
- **クラウドベンダー等のアイコン**:
  - ステンシルに含まれる AWS (Amazon Web Services)、GCP (Google Cloud)、Microsoft Azure、Kubernetes、Cisco 等のアーキテクチャアイコンに関する商標権・著作権は各権利者に帰属します。

### 4. ランタイム依存パッケージ
- [`@resvg/resvg-js`](https://github.com/thx/resvg-js): **MPL-2.0** (Mozilla Public License 2.0) — `package.json` の npm 依存として利用しています。
