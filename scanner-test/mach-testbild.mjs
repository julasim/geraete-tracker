import { writeBarcode } from "zxing-wasm/writer";
import { writeFile } from "node:fs/promises";
const r = await writeBarcode("10001", { format: "Code39", scale: 5 });
await writeFile("public/test-etikett.png", Buffer.from(await r.image.arrayBuffer()));
console.log("geschrieben, Bytes:", (await r.image.arrayBuffer()).byteLength);
