import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  convertXmlToPng,
  convertXmlToSvg,
  extractDrawioPages,
  extractDrawioXmlFromPng,
  isPngBuffer,
} from "../src/index.mjs";

const SAMPLE_FLOWCHART_XML = `
<mxfile host="Electron" version="26.0.0">
  <diagram id="flow-1" name="基本図形とフローチャート">
    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="v1" value="&lt;b&gt;開始&lt;/b&gt;&lt;br&gt;ユーザーリクエスト" style="rounded=1;whiteSpace=wrap;html=1;arcSize=50;fillColor=#d5e8d4;strokeColor=#82b366;shadow=1;" vertex="1" parent="1">
          <mxGeometry x="60" y="40" width="140" height="60" as="geometry" />
        </mxCell>
        <mxCell id="v2" value="認証チェック&lt;br&gt;&lt;font color=&quot;#b85450&quot;&gt;JWT / OAuth2&lt;/font&gt;" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
          <mxGeometry x="260" y="30" width="150" height="80" as="geometry" />
        </mxCell>
        <mxCell id="v3" value="&lt;b&gt;PostgreSQL&lt;/b&gt;&lt;br&gt;メインDB" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="490" y="30" width="120" height="80" as="geometry" />
        </mxCell>
        <mxCell id="v4" value="外部クラウドAPI" style="ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;" vertex="1" parent="1">
          <mxGeometry x="60" y="160" width="150" height="80" as="geometry" />
        </mxCell>
        <mxCell id="v5" value="管理者" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="1">
          <mxGeometry x="290" y="165" width="40" height="70" as="geometry" />
        </mxCell>
        <mxCell id="v6" value="データ変換処理" style="shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#f5f5f5;strokeColor=#666666;" vertex="1" parent="1">
          <mxGeometry x="400" y="170" width="140" height="60" as="geometry" />
        </mxCell>
        <mxCell id="v7" value="バッチ検証" style="shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1">
          <mxGeometry x="580" y="170" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="v8" value="ステップ実行" style="shape=step;perimeter=stepPerimeter;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="60" y="280" width="140" height="60" as="geometry" />
        </mxCell>
        <mxCell id="v9" value="監査ログ出力" style="shape=document;whiteSpace=wrap;html=1;boundedLbl=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
          <mxGeometry x="250" y="280" width="130" height="65" as="geometry" />
        </mxCell>
        <mxCell id="v10" value="注意事項メモ" style="shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=15;fillColor=#ffffc0;strokeColor=#999900;" vertex="1" parent="1">
          <mxGeometry x="430" y="280" width="120" height="65" as="geometry" />
        </mxCell>
        <mxCell id="v11" value="完了通知！" style="shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;size=20;position=0.5;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
          <mxGeometry x="590" y="275" width="120" height="70" as="geometry" />
        </mxCell>
        <mxCell id="e1" value="HTTPS" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;strokeWidth=2;strokeColor=#333333;" edge="1" parent="1" source="v1" target="v2">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e2" value="OK" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeColor=#82b366;strokeWidth=2;" edge="1" parent="1" source="v2" target="v3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`.trim();

test("1. Basic shapes, connectors, HTML & Japanese labels render to SVG and PNG", () => {
  const res = convertXmlToPng(SAMPLE_FLOWCHART_XML, {
    scale: 2,
    border: 12,
    embedXml: true,
    dpi: 144,
  });

  assert.ok(isPngBuffer(res.png), "Output must be a valid PNG buffer");
  assert.ok(res.width > 600, `Expected width > 600, got ${res.width}`);
  assert.ok(res.height > 300, `Expected height > 300, got ${res.height}`);
  assert.ok(res.svg.includes("ユーザーリクエスト"), "SVG should contain Japanese text");
  assert.ok(res.svg.includes("PostgreSQL"), "SVG should contain DB text");
  assert.ok(res.svg.includes("mx-drop-shadow"), "SVG should include drop shadow filter");
});

test("2. Compressed .drawio (<diagram> with raw Deflate + Base64 + encodeURIComponent) and multi-page support", () => {
  const innerModel1 = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="圧縮ページ1" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>`;
  const innerModel2 = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="b" value="圧縮ページ2 (%page%)" placeholders="1" style="ellipse;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="140" height="70" as="geometry"/></mxCell></root></mxGraphModel>`;

  const compressed1 = zlib
    .deflateRawSync(Buffer.from(encodeURIComponent(innerModel1), "utf8"))
    .toString("base64");
  const compressed2 = zlib
    .deflateRawSync(Buffer.from(encodeURIComponent(innerModel2), "utf8"))
    .toString("base64");

  const compressedDrawio = `<mxfile><diagram id="p1" name="Overview">${compressed1}</diagram><diagram id="p2" name="DetailPage">${compressed2}</diagram></mxfile>`;

  const { pages } = extractDrawioPages(compressedDrawio);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].name, "Overview");
  assert.equal(pages[1].name, "DetailPage");

  const page1Res = convertXmlToPng(compressedDrawio, { page: 1 });
  assert.ok(page1Res.svg.includes("圧縮ページ1"));

  const page2Res = convertXmlToPng(compressedDrawio, { page: "DetailPage" });
  assert.ok(page2Res.svg.includes("圧縮ページ2 (DetailPage)"));
  assert.ok(isPngBuffer(page2Res.png));
});

test("3. PNG zTXt chunk XML embedding & round-trip extraction from .drawio.png", () => {
  const firstPass = convertXmlToPng(SAMPLE_FLOWCHART_XML, {
    scale: 1,
    embedXml: true,
    dpi: 150,
  });

  const extractedXml = extractDrawioXmlFromPng(firstPass.png);
  assert.ok(extractedXml, "Should extract embedded XML from zTXt chunk");
  assert.ok(extractedXml.includes("PostgreSQL"), "Extracted XML should match original diagram");

  // Re-render directly from the .drawio.png Buffer!
  const secondPass = convertXmlToPng(firstPass.png, { scale: 1 });
  assert.ok(isPngBuffer(secondPass.png));
  assert.equal(secondPass.width, firstPass.width);
  assert.equal(secondPass.height, firstPass.height);
});

test("4. Composite shapes: Swimlanes, Containers, Groups, and Tables (table/tableRow/tableCell)", () => {
  const compositeXml = `
  <mxGraphModel>
    <root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="lane1" value="バックエンドサービス領域 (Swimlane)" style="swimlane;startSize=30;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;" vertex="1" parent="1">
        <mxGeometry x="40" y="40" width="320" height="180" as="geometry"/>
      </mxCell>
      <mxCell id="child1" value="ワーカー1" style="rounded=1;fillColor=#ffffff;strokeColor=#6c8ebf;" vertex="1" parent="lane1">
        <mxGeometry x="30" y="60" width="110" height="50" as="geometry"/>
      </mxCell>
      <mxCell id="child2" value="ワーカー2" style="rounded=1;fillColor=#ffffff;strokeColor=#6c8ebf;" vertex="1" parent="lane1">
        <mxGeometry x="180" y="60" width="110" height="50" as="geometry"/>
      </mxCell>
      <mxCell id="ce1" value="同期" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="lane1" source="child1" target="child2">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
      <mxCell id="tbl" value="ユーザーテーブル" style="shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=1;fontStyle=1;align=center;resizeLast=1;fillColor=#f5f5f5;strokeColor=#666666;" vertex="1" parent="1">
        <mxGeometry x="400" y="40" width="240" height="120" as="geometry"/>
      </mxCell>
      <mxCell id="row1" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=1;" vertex="1" parent="tbl">
        <mxGeometry y="30" width="240" height="45" as="geometry"/>
      </mxCell>
      <mxCell id="tc1" value="id (PK)" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=1;align=left;spacingLeft=6;fontStyle=1;" vertex="1" parent="row1">
        <mxGeometry width="100" height="45" as="geometry"/>
      </mxCell>
      <mxCell id="tc2" value="UUID" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=6;" vertex="1" parent="row1">
        <mxGeometry x="100" width="140" height="45" as="geometry"/>
      </mxCell>
      <mxCell id="row2" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=0;" vertex="1" parent="tbl">
        <mxGeometry y="75" width="240" height="45" as="geometry"/>
      </mxCell>
      <mxCell id="tc3" value="email" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=1;align=left;spacingLeft=6;" vertex="1" parent="row2">
        <mxGeometry width="100" height="45" as="geometry"/>
      </mxCell>
      <mxCell id="tc4" value="VARCHAR(255)" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=6;" vertex="1" parent="row2">
        <mxGeometry x="100" width="140" height="45" as="geometry"/>
      </mxCell>
    </root>
  </mxGraphModel>
  `;

  const res = convertXmlToPng(compositeXml, { scale: 2 });
  assert.ok(isPngBuffer(res.png));
  assert.ok(res.svg.includes("バックエンドサービス領域"));
  assert.ok(res.svg.includes("ユーザーテーブル"));
  assert.ok(res.svg.includes("VARCHAR(255)"));
});

test("5. Cloud & Architecture Stencils (AWS4, GCP2, Azure, Kubernetes, Flowchart)", () => {
  const stencilXml = `
  <mxGraphModel>
    <root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="vpc" value="AWS VPC" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;strokeColor=#248814;fillColor=#E9F3E6;verticalAlign=top;align=left;spacingLeft=30;dashed=0;" vertex="1" parent="1">
        <mxGeometry x="40" y="40" width="520" height="220" as="geometry"/>
      </mxCell>
      <mxCell id="lambda" value="AWS Lambda" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="vpc">
        <mxGeometry x="40" y="70" width="60" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="dynamo" value="Amazon DynamoDB" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#C925D1;strokeColor=#ffffff;" vertex="1" parent="vpc">
        <mxGeometry x="180" y="70" width="60" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="k8s" value="Kubernetes Pod" style="html=1;dashed=0;whitespace=wrap;fillColor=#2875E2;strokeColor=#ffffff;points=[[0.005,0.63,0],[0.1,0.2,0],[0.9,0.2,0],[0.5,0,0],[0.995,0.63,0],[0.72,0.99,0],[0.28,0.99,0]];shape=mxgraph.kubernetes.icon2;prIcon=pod;verticalLabelPosition=bottom;verticalAlign=top;" vertex="1" parent="vpc">
        <mxGeometry x="320" y="70" width="60" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="azure" value="Azure VM" style="aspect=fixed;html=1;points=[];align=center;image;fontSize=12;shape=mxgraph.azure.virtual_machine;fillColor=#0072C6;strokeColor=none;verticalLabelPosition=bottom;verticalAlign=top;" vertex="1" parent="vpc">
        <mxGeometry x="430" y="70" width="60" height="55" as="geometry"/>
      </mxCell>
      <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=classic;strokeColor=#232F3E;strokeWidth=2;" edge="1" parent="vpc" source="lambda" target="dynamo">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
      <mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=classic;strokeColor=#232F3E;strokeWidth=2;" edge="1" parent="vpc" source="dynamo" target="k8s">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
    </root>
  </mxGraphModel>
  `;

  const svgRes = convertXmlToSvg(stencilXml);
  // Stencil paths should be emitted in SVG
  const pathCount = (svgRes.svg.match(/<path /g) || []).length;
  assert.ok(pathCount >= 10, `Expected stencil paths >= 10, got ${pathCount}`);

  const pngRes = convertXmlToPng(stencilXml, { scale: 2 });
  assert.ok(isPngBuffer(pngRes.png));
  assert.ok(pngRes.width > 900);
});
