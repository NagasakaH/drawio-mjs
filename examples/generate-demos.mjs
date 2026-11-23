import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertDrawioFile } from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

const ARCHITECTURE_DRAWIO = `
<mxfile host="drawio-xml2png" version="1.0.0">
  <diagram id="arch-cloud" name="クラウドアーキテクチャ構成図">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- Title Banner -->
        <mxCell id="title" value="&lt;b style=&quot;font-size:18px&quot;&gt;マイクロサービス &amp; クラウド基盤アーキテクチャ&lt;/b&gt;&lt;br&gt;&lt;font color=&quot;#555555&quot;&gt;Pure Node.js (.mjs) draw.io XML → PNG Generator Demo&lt;/font&gt;" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;arcSize=15;" vertex="1" parent="1">
          <mxGeometry x="40" y="20" width="960" height="55" as="geometry" />
        </mxCell>

        <!-- Client Actors -->
        <mxCell id="user" value="&lt;b&gt;エンドユーザー&lt;/b&gt;&lt;br&gt;Web / Mobile" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="65" y="195" width="45" height="80" as="geometry" />
        </mxCell>

        <!-- AWS VPC Group -->
        <mxCell id="vpc" value="AWS Production VPC (10.0.0.0/16)" style="points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=14;fontStyle=1;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;strokeColor=#248814;fillColor=#F2F8F0;verticalAlign=top;align=left;spacingLeft=35;strokeWidth=2;" vertex="1" parent="1">
          <mxGeometry x="180" y="95" width="555" height="450" as="geometry" />
        </mxCell>

        <!-- API Gateway & Auth -->
        <mxCell id="apigw" value="&lt;b&gt;Amazon API Gateway&lt;/b&gt;" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fillColor=#E7157B;strokeColor=#ffffff;" vertex="1" parent="vpc">
          <mxGeometry x="35" y="105" width="64" height="64" as="geometry" />
        </mxCell>

        <mxCell id="auth_check" value="&lt;b&gt;認証・認可&lt;/b&gt;&lt;br&gt;JWT検証" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;shadow=1;" vertex="1" parent="vpc">
          <mxGeometry x="155" y="100" width="120" height="74" as="geometry" />
        </mxCell>

        <!-- Compute Swimlane inside VPC -->
        <mxCell id="compute_lane" value="アプリケーション層 (Swimlane)" style="swimlane;startSize=28;fillColor=#dae8fc;strokeColor=#6c8ebf;swimlaneFillColor=#ffffff;fontStyle=1;rounded=1;shadow=1;" vertex="1" parent="vpc">
          <mxGeometry x="320" y="45" width="210" height="230" as="geometry" />
        </mxCell>

        <mxCell id="lambda" value="&lt;b&gt;AWS Lambda&lt;/b&gt;&lt;br&gt;注文処理" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="compute_lane">
          <mxGeometry x="25" y="65" width="60" height="60" as="geometry" />
        </mxCell>

        <mxCell id="k8s_pod" value="&lt;b&gt;EKS Pod&lt;/b&gt;&lt;br&gt;決済連携" style="html=1;dashed=0;whitespace=wrap;fillColor=#2875E2;strokeColor=#ffffff;shape=mxgraph.kubernetes.icon2;prIcon=pod;verticalLabelPosition=bottom;verticalAlign=top;" vertex="1" parent="compute_lane">
          <mxGeometry x="125" y="67" width="56" height="56" as="geometry" />
        </mxCell>

        <!-- Data Layer inside VPC -->
        <mxCell id="rds" value="&lt;b&gt;Aurora PostgreSQL&lt;/b&gt;&lt;br&gt;Primary DB" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;fillColor=#d5e8d4;strokeColor=#82b366;shadow=1;" vertex="1" parent="vpc">
          <mxGeometry x="280" y="320" width="130" height="85" as="geometry" />
        </mxCell>

        <mxCell id="dynamo" value="&lt;b&gt;DynamoDB&lt;/b&gt;&lt;br&gt;セッションストア" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#C925D1;strokeColor=#ffffff;" vertex="1" parent="vpc">
          <mxGeometry x="445" y="325" width="64" height="64" as="geometry" />
        </mxCell>

        <mxCell id="note1" value="&lt;b&gt;監査ログ&lt;/b&gt;&lt;br&gt;S3へ非同期転送" style="shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=14;fillColor=#ffffc0;strokeColor=#999900;" vertex="1" parent="vpc">
          <mxGeometry x="45" y="325" width="120" height="75" as="geometry" />
        </mxCell>

        <!-- Schema Table on Right -->
        <mxCell id="orders_tbl" value="orders (テーブル定義)" style="shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=1;fontStyle=1;align=center;resizeLast=1;fillColor=#e1d5e7;strokeColor=#9673a6;swimlaneFillColor=#ffffff;shadow=1;" vertex="1" parent="1">
          <mxGeometry x="775" y="95" width="245" height="165" as="geometry" />
        </mxCell>
        <mxCell id="r1" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=1;" vertex="1" parent="orders_tbl">
          <mxGeometry y="30" width="245" height="45" as="geometry" />
        </mxCell>
        <mxCell id="c11" value="PK" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=1;fontStyle=1;align=center;" vertex="1" parent="r1">
          <mxGeometry width="45" height="45" as="geometry" />
        </mxCell>
        <mxCell id="c12" value="order_id (UUID)" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=8;fontStyle=1;" vertex="1" parent="r1">
          <mxGeometry x="45" width="200" height="45" as="geometry" />
        </mxCell>
        <mxCell id="r2" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=1;" vertex="1" parent="orders_tbl">
          <mxGeometry y="75" width="245" height="45" as="geometry" />
        </mxCell>
        <mxCell id="c21" value="FK" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=1;align=center;" vertex="1" parent="r2">
          <mxGeometry width="45" height="45" as="geometry" />
        </mxCell>
        <mxCell id="c22" value="customer_id (BIGINT)" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=8;" vertex="1" parent="r2">
          <mxGeometry x="45" width="200" height="45" as="geometry" />
        </mxCell>
        <mxCell id="r3" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=0;" vertex="1" parent="orders_tbl">
          <mxGeometry y="120" width="245" height="45" as="geometry" />
        </mxCell>
        <mxCell id="c31" value="" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=1;align=center;" vertex="1" parent="r3">
          <mxGeometry width="45" height="45" as="geometry" />
        </mxCell>
        <mxCell id="c32" value="total_amount (NUMERIC)" style="shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=8;" vertex="1" parent="r3">
          <mxGeometry x="45" width="200" height="45" as="geometry" />
        </mxCell>

        <!-- External Cloud box on Bottom Right -->
        <mxCell id="ext_cloud" value="&lt;b&gt;外部決済プロバイダ&lt;/b&gt;&lt;br&gt;Stripe / PayJP" style="ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;shadow=1;" vertex="1" parent="1">
          <mxGeometry x="795" y="340" width="205" height="115" as="geometry" />
        </mxCell>

        <!-- Edges -->
        <mxCell id="edge_user_gw" value="HTTPS" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;strokeWidth=2;strokeColor=#0066CC;" edge="1" parent="1" source="user" target="apigw">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="edge_gw_auth" value="Verify" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;strokeWidth=2;strokeColor=#333333;" edge="1" parent="vpc" source="apigw" target="auth_check">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="edge_auth_lambda" value="OK" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=2;strokeColor=#248814;" edge="1" parent="vpc" source="auth_check" target="lambda">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="edge_lambda_rds" value="SQL Write" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;exitX=0.5;exitY=1;entryX=0.5;entryY=0;endArrow=classic;strokeWidth=2;strokeColor=#82b366;" edge="1" parent="vpc" source="compute_lane" target="rds">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="edge_pod_dynamo" value="Get/Put" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;exitX=0.75;exitY=1;entryX=0.5;entryY=0;endArrow=classic;strokeWidth=2;strokeColor=#C925D1;" edge="1" parent="vpc" source="compute_lane" target="dynamo">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="edge_rds_note" value="Audit" style="edgeStyle=orthogonalEdgeStyle;rounded=1;dashed=1;html=1;endArrow=open;strokeWidth=1.5;strokeColor=#999900;" edge="1" parent="vpc" source="rds" target="note1">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="edge_rds_tbl" value="スキーマ参照" style="edgeStyle=orthogonalEdgeStyle;rounded=1;dashed=1;html=1;exitX=0.5;exitY=1;entryX=0.5;entryY=1;endArrow=ERmany;startArrow=ERmandOne;strokeWidth=1.5;strokeColor=#9673a6;" edge="1" parent="1" source="rds" target="orders_tbl">
          <mxGeometry relative="1" as="geometry">
            <Array as="points">
              <mxPoint x="525" y="520" />
              <mxPoint x="755" y="520" />
              <mxPoint x="755" y="280" />
              <mxPoint x="897" y="280" />
            </Array>
          </mxGeometry>
        </mxCell>

        <mxCell id="edge_pod_ext" value="Webhook" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;exitX=1;exitY=0.5;entryX=0.5;entryY=0;endArrow=classic;strokeWidth=2;strokeColor=#d79b00;" edge="1" parent="1" source="compute_lane" target="ext_cloud">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`.trim();

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const drawioPath = path.join(OUT_DIR, "cloud-architecture.drawio");
  const pngPath = path.join(OUT_DIR, "cloud-architecture.drawio.png");
  const svgPath = path.join(OUT_DIR, "cloud-architecture.drawio.svg");

  await fs.writeFile(drawioPath, ARCHITECTURE_DRAWIO, "utf8");

  const pngRes = await convertDrawioFile(drawioPath, pngPath, {
    scale: 2,
    border: 16,
    embedXml: true,
    dpi: 144,
  });

  const svgRes = await convertDrawioFile(drawioPath, svgPath, {
    format: "svg",
    scale: 1,
    border: 16,
    embedXml: true,
  });

  console.log(`Generated PNG: ${pngRes.outputPath} (${pngRes.width}x${pngRes.height}px)`);
  console.log(`Generated SVG: ${svgRes.outputPath} (${svgRes.width}x${svgRes.height}px)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
