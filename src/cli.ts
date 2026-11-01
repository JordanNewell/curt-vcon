#!/usr/bin/env node
/**
 * CLI:
 *   curt-vcon to-vcon in.curt > out.vcon.json
 *   curt-vcon to-curt in.vcon.json > out.curt
 */

import { readFileSync } from "node:fs";
import { parseCurt, serializeCurt } from "curt-format";
import { curtToVcon, vconToCurt } from "./index.js";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  curt-vcon to-vcon <in.curt>        Convert a .curt file to vCon JSON on stdout",
      "  curt-vcon to-curt <in.vcon.json>   Convert a vCon JSON file to a .curt body on stdout",
    ].join("\n"),
  );
  process.exit(2);
}

function main(): void {
  const [command, inputPath] = process.argv.slice(2);
  if (!command || !inputPath) usage();

  let raw: string;
  try {
    raw = readFileSync(inputPath, "utf8");
  } catch (err) {
    console.error(`curt-vcon: cannot read ${inputPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  if (command === "to-vcon") {
    const curt = parseCurt(raw);
    if (curt === null) {
      console.error(`curt-vcon: ${inputPath} is not a valid .curt file`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(curtToVcon(curt), null, 2) + "\n");
    return;
  }

  if (command === "to-curt") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`curt-vcon: ${inputPath} is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
    const curt = vconToCurt(parsed);
    if (curt === null) {
      console.error(`curt-vcon: ${inputPath} is not a convertible vCon object`);
      process.exit(1);
    }
    process.stdout.write(serializeCurt(curt, "curt-vcon@0.1.0") + "\n");
    return;
  }

  usage();
}

main();
