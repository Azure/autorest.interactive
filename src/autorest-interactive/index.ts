import { ipcRenderer, remote } from 'electron';
import * as $ from 'jquery';
import * as d3 from 'd3';
import { stringify } from 'jsonpath';
import { JsonPath } from '../jsonrpc/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';

// window.onerror = e => remote.dialog.showErrorBox("Unhandled Error", e);
window.onerror = (e) => { };

function remoteEval(expression: string): any {
  return ipcRenderer.sendSync("remoteEval", expression);
}
function readFile(uri: string): any {
  return ipcRenderer.sendSync("readFile", uri);
}

let nodes: PipelineNode[];
let opened = false;
let tmpFolder;
function deconstruct(identifier) {
    if (Array.isArray(identifier)) {
        return [].concat.apply([], [...identifier.map(deconstruct)]);
    }
    return identifier.replace(/([a-z]+)([A-Z])/g, '$1 $2').replace(/(\d+)([a-z|A-Z]+)/g, '$1 $2').split(/[\W|_]+/);
}
exports.deconstruct = deconstruct;
function copyToTmp(outputUris) {
    if (opened) {
        if (outputUris) {
            for (const each of outputUris) {
                let filename = each.replace(/\%..?/g, '.').replace(/(\d*)\?/g, '($1)+').replace('mem:///', '').replace('https...', '');
                if (filename.endsWith('...')) {
                    filename = filename.replace('...', '.json');
                }
                fs.writeFileSync(
                    path.join(tmpFolder, filename),
                    readFile(each)
                );
            }
        }
    }
}
function openInCode() {
    if (!opened) {
        opened = true;
        tmpFolder = fs.mkdtempSync(`${os.tmpdir()}/autorest-tmp-`);
        cp.exec(`code --new-window ${tmpFolder}`);
        for (const node of nodes) {
            copyToTmp(node.state.outputUris);
        }
    }
}

type PipelineNodeState = {
  state: "running" | "failed" | "complete";
  outputUris?: string[];
  finishedAt?: number;
};
type PipelineNode = {
  outputArtifact?: string;
  pluginName: string;
  configScope: JsonPath;
  inputs: string[];
  // artificial
  key: string;
  displayName: string[];
  x: number;
  y: number;
  depth: number;
  state: PipelineNodeState;
};

$(() => {
  const startTime = remoteEval("startTime");
  const pipeline: { [name: string]: PipelineNode } = remoteEval("pipeline");

  const depth = (node: PipelineNode) => node.inputs.map(i => depth(pipeline[i]) + 1).reduce((a, b) => Math.max(a, b), 0);
  const runningTime: (node: PipelineNode) => number | null = node => {
    const selfFinished = node.state.finishedAt;
    if (!selfFinished) {
      return null;
    }
    const previousFinished = node.inputs.map(x => pipeline[x].state.finishedAt).reduce((a, b) => !b ? undefined : Math.max(a, b), startTime) || selfFinished;
    return ((selfFinished || Date.now()) - (previousFinished || selfFinished)) / 1000;
  };

  nodes = Object.keys(pipeline).map(key => Object.assign(pipeline[key], { key: key, displayName: key.split("/") }));
  const links: { source: PipelineNode, target: PipelineNode }[] = [].concat.apply([],
    nodes.map(node => node.inputs.map(input => {
      return {
        source: pipeline[input],
        target: node
      };
    })));

  // horiz layout
  nodes.forEach(n => n.depth = depth(n));
  nodes.forEach(n => n.x = 0);
  nodes.forEach((n, i) => n.y = i / 10);
  const width = nodes.map(x => x.depth).reduce((a, b) => Math.max(a, b), 0);
  const height = width * 0.7;

  const simulation = d3.forceSimulation(nodes)
    .force("charge", d3.forceManyBody().strength(-1).distanceMin(10).distanceMin(30))
    .force("link", d3.forceLink(links).distance(1).strength(1).iterations(10))
    .force("y", d3.forceY(0))
    .stop();
  for (var i = 0; i < 1; ++i) {
    simulation.tick();
    nodes.forEach(n => n.y = Math.min(Math.max(n.y, -height / 2), height / 2));
    for (let d = 0; d <= width; ++d) {
      const nodeSet = nodes.filter(n => n.depth === d);
      const meanY = nodeSet.map(n => n.y).reduce((a, b) => a + b, 0) / nodeSet.length;
      for (let i = 0; i < nodeSet.length; ++i) {
        const n = nodeSet[i];
        n.x = d - width / 2;
        n.y = meanY + (i - nodeSet.length / 2) * 1.3;
      }
    }
  }
  const vis = d3.select("#pipelineGraph").attr("viewBox", `0 0 ${width} ${height}`).append("g").attr("transform", `translate(${width / 2 - 1},${height / 2 - 1})`);

  let lastFootprint: string = null;
  const render = () => {
    const footprint = JSON.stringify(nodes) + JSON.stringify(links);
    if (lastFootprint === footprint) return;
    lastFootprint = footprint;

    const lineData = vis.selectAll("line.edge").data(links);
    {
      const enter = lineData.enter().append("line").attr("class", "edge").attr("stroke", "#000").attr("stroke-width", 0.02);
      lineData.merge(enter)
        .attr("x1", d => d.source.x.toFixed(3))
        .attr("y1", d => d.source.y.toFixed(3))
        .attr("x2", d => d.target.x.toFixed(3))
        .attr("y2", d => d.target.y.toFixed(3));
      lineData.exit().remove();
    }

    const nodeData = vis.selectAll(".node").data(nodes);
    {
      const enter = nodeData.enter()
        .append("g")
        .attr("class", "node")
        .attr("stroke", "#000")
        .attr("fill", "#FFF")
        .attr("stroke-width", 0.03)
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .append("g")
        .attr("class", "scalable")
        .on("click", showNodeDetails)
        // .on("mousedown", d => moveNodeStart(d, d3.event))
        // .on("mousemove", d => moveNode(d, d3.event))
        // .on("mouseup", d => moveNodeEnd(d, d3.event))
        ;
      nodeData.exit().remove();
      const update = nodeData.select(".scalable").merge(enter);
      update.selectAll("*").remove();
      update.append("circle")
        .attr("r", "0.45em")
        .attr("fill", d => d.state.state === "running"
          ? "#FFF"
          : (d.state.state === "complete"
            ? `hsl(${(100 - 100 * Math.min(Math.max((runningTime(d) || 0) / 10, 0), 1)) | 0}, 100%, 80%)`
            : "#000"));
      update.append("text")
        .attr("text-anchor", "middle")
        .attr("style", d => `font-size: ${1.7 / (d.displayName.reduce((a, b) => Math.max(a, b.length), 0) + 1)}em`)
                        .html(d => d.displayName.map((l, i) => `<tspan x="0" y="${(i - (d.displayName.length - 1) / 2) * 1.3 + 0.4}em">${l}</tspan>`).join(""))
        .attr("fill", d => d.state.state === "failed" ? "#FFF" : "#000").attr("stroke-width", 0);
      update.append("text")
        .attr("text-anchor", "middle")
        .attr("y", "3.2em")
        .attr("style", `font-size: 0.2em; font-weight: bold`)
        .text(d => {
          const sec = (runningTime(d) || 0).toFixed(1);
          return sec === "0.0" || sec === "0.1" ? "" : `${sec}s`;
        })
        .attr("fill", "#000").attr("stroke-width", 0);
    }
  };

  const update = () => {
    const states = remoteEval(`tasks`);
    for (const node of nodes) {
      node.state = node.state || { state: "running" };
      node.state.state = states[node.key]._state;
      node.state.finishedAt = states[node.key]._finishedAt;
      if (node.state.state === "complete" && !node.state.outputUris) {
        node.state.outputUris = remoteEval(`tasks[${JSON.stringify(node.key)}]._result().map(x => x.key)`);
        copyToTmp(node.state.outputUris);
      }
    }
  };

  const refresh = () => { update(); render(); };

  refresh();
  setInterval(refresh, 100);

  // $("#pipelineGraph").text(JSON.stringify(pipeline, null, 2));
  // setInterval(() => {
  //   $("body").text(JSON.stringify(3));
  // }, 1000);
});

function showOverlay(title: string, content: JQuery): void {
  const overlay = $("<div>");
  overlay.append($("<h1>")
    .append($("<button>").text("X").click(() => overlay.remove()))
    .append($("<span>").text(title)));
  overlay.append($("<div>").append(content));
  overlay.click(() => {});
  $("#overlays").append(overlay);
}

function showNodeDetails(node: PipelineNode): void {
  const table = $("<table>");
  table.append($("<tr>")
    .append($("<td>").text("Plugin"))
    .append($("<td>").text(node.pluginName)));
  table.append($("<tr>")
    .append($("<td>").text("Configuration Scope"))
    .append($("<td>").text(stringify(["$"].concat(node.configScope as any)))));
    table.append($("<tr>")
      .append($("<td>").text("Output"))
      .append($("<td>").append(node.state.outputUris.map(uri => $("<a>")
      .attr("href", "#")
      .text(uri)
      .click(() => showUriDetails(uri))
      .append($("<br>"))))));

  // ext. extension
  const extensionName = remoteEval(`(external[${JSON.stringify(node.pluginName)}] || {}).extensionName`);
  if (extensionName) {
    table.append($("<tr>")
      .append($("<td>").text("Extension"))
      .append($("<td>").append(extensionName)));
    const traffic = remoteEval(`external[${JSON.stringify(node.pluginName)}].__inspectTraffic`);
    for (const [timeStamp, isCore2Ext, payload] of traffic) {
        const payloadShortened = payload.length > 200 ? payload.substr(0, 200) + "..." : payload;
        table.append($("<tr>").css("background", isCore2Ext ? "#FEE" : "#EFE")
            .append($("<td>").text(new Date(timeStamp).toLocaleTimeString() + (isCore2Ext ? " (core => ext)" : " (ext => core)")))
            .append($("<td>").append($("<a>")
            .attr("href", "#")
            .text(payloadShortened)
            .click(() => showOverlay("", $("<textarea>").val(payload))))));
    }
  }
  showOverlay(node.key, table);
}

function showUriDetails(uri: string): void {
  const content = $("<pre>").css("font-family", "monospace").text(readFile(uri));
  content.click(e => {
    const s = window.getSelection();
    // showBlameTreeDetails(remoteEval(`blame(${JSON.stringify(uri)}, ${JSON.stringify({ index: s.anchorOffset })})`));
  });
  showOverlay(uri, content);
}

type BlameTree = { node: any, blaming: BlameTree[] };

function showBlameTreeDetails(blameTree: BlameTree): void {
  const content = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  const depth = (blameTree: BlameTree) => blameTree.blaming.map(n => depth(n) + 1).reduce((a, b) => Math.max(a, b), 0);
  const getNodes: (blameTree: BlameTree) => BlameTree[] = blameTree => [blameTree].concat(...blameTree.blaming.map(getNodes));

  const nodes: (BlameTree & {
    displayName: string[];
    depth: number;
    x: number;
    y: number;
  })[] = getNodes(blameTree).map(node => Object.assign(node, { displayName: [node.node.source, node.node.line + ":" + node.node.column] } as any));
  const links: { source: PipelineNode, target: PipelineNode }[] = [].concat.apply([],
    nodes.map(node => node.blaming.map(input => {
      return {
        source: input,
        target: node
      };
    })));

  // horiz layout
  nodes.forEach(n => n.depth = depth(n));
  nodes.forEach((n, i) => n.x = i / 10);
  const height = nodes.map(x => x.depth).reduce((a, b) => Math.max(a, b), 0);
  let width = 5;
  for (let i = 0; i <= height; ++i) {
    width = Math.max(width, nodes.filter(n => n.depth === i).length);
  }

  const simulation = d3.forceSimulation(nodes)
    .force("charge", d3.forceManyBody().strength(-1).distanceMin(10).distanceMin(30))
    .force("link", d3.forceLink(links).distance(1).strength(1).iterations(10))
    .force("x", d3.forceX(0))
    .stop();
  for (var i = 0; i < 1; ++i) {
    simulation.tick();
    nodes.forEach(n => n.x = Math.min(Math.max(n.x, -width / 2), width / 2));
    for (let d = 0; d <= height; ++d) {
      const nodeSet = nodes.filter(n => n.depth === d);
      for (let i = 0; i < nodeSet.length; ++i) {
        const n = nodeSet[i];
        n.y = 5 * (d - height / 2);
        n.x = 0 + (i - nodeSet.length / 2) * 1;
      }
    }
  }

  const vis = d3.select(content).attr("viewBox", `0 0 ${width + 2} ${5 * (height + 1)}`).append("g").attr("transform", `translate(${width / 2 + 1},${5 * (height + 1) / 2})`);

  let lastFootprint: string = null;

  const footprint = JSON.stringify(nodes) + JSON.stringify(links);
  if (lastFootprint === footprint) return;
  lastFootprint = footprint;

  const lineData = vis.selectAll("line.edge").data(links);
  {
    const enter = lineData.enter().append("line").attr("class", "edge").attr("stroke", "#000").attr("stroke-width", 0.02);
    lineData.merge(enter)
      .attr("x1", d => d.source.x.toFixed(3))
      .attr("y1", d => d.source.y.toFixed(3))
      .attr("x2", d => d.target.x.toFixed(3))
      .attr("y2", d => d.target.y.toFixed(3));
    lineData.exit().remove();
  }

  const nodeData = vis.selectAll(".node").data(nodes);
  {
    const enter = nodeData.enter()
      .append("g")
      .attr("writing-mode", "tb-rl")
      .attr("class", "node")
      .attr("stroke", "#000")
      .attr("fill", "#FFF")
      .attr("stroke-width", 0.03)
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .append("g")
      .attr("class", "scalable")
      .on("click", d => remote.dialog.showMessageBox({ title: d.node.source, message: d.node.name }))
      ;
    const update = nodeData.select(".scalable").merge(enter);
    update.selectAll("*").remove();
    update.append("rect")
      .attr("width", "0.9em")
      .attr("height", "4.9em")
      .attr("x", "-0.45em")
      .attr("y", "-2.45em")
      .attr("fill", "#FFF");
    update.append("text")
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("style", d => `font-size: ${10 / (d.displayName.reduce((a, b) => Math.max(a, b.length), 0) + 1)}em`)
      .html(d => d.displayName.map((l, i) => `<tspan y="0" x="${-(i - (d.displayName.length - 1) / 2) * 1.3 - 0.3}em">${l}</tspan>`).join(""))
      .attr("stroke-width", 0);
    update.append("text")
      .attr("text-anchor", "middle")
      .attr("y", "3.2em")
      .attr("style", `font-size: 0.2em; font-weight: bold`)
      .text(d => "")
      .attr("fill", "#000").attr("stroke-width", 0);
  }
  showOverlay(`Blame`, <any>$(content));
}

// let deltaX: number | null = null;
// let deltaY: number | null = null;

// function moveNodeStart(node: PipelineNode, e: MouseEvent): void {
//   deltaX = e.pageX - node.x;
//   deltaY = e.pageY - node.y;
// }

// function moveNode(node: PipelineNode, e: MouseEvent): void {
//   if (deltaX !== null) {
//     node.x = e.pageX - deltaX;
//     node.y = e.pageY - deltaY;
//   }
// }

// function moveNodeEnd(node: PipelineNode, e: MouseEvent): void {
//   deltaX = null;
//   deltaY = null;
// }