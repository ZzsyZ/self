import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";

const APP_ID = "habit_mirror_v5_pro";

const args = process.argv.slice(2);
const backupPath = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const targetUidArg = args.find((arg) => arg.startsWith("--uid="));
const proxyArg = args.find((arg) => arg.startsWith("--proxy="));
const merge = !args.includes("--replace");

if (!backupPath) {
  console.error(
    "Usage: node scripts/import-backup.mjs <backup.md> [--dry-run] [--uid=SYNC_ID] [--replace] [--proxy=http://127.0.0.1:7890]",
  );
  process.exit(1);
}

loadDotEnv(path.resolve(".env.local"));

const text = fs.readFileSync(backupPath, "utf8");
const parsed = parseBackup(text);
const targetUid = targetUidArg?.slice("--uid=".length) || parsed.uid;

if (!targetUid) {
  console.error("No target UID found. Pass --uid=SYNC_ID.");
  process.exit(1);
}

console.log(`Target UID: ${targetUid}`);
console.log(`Records: ${parsed.records.length}`);
console.log(
  `Habits: ${parsed.records.reduce((sum, record) => sum + record.habits.length, 0)}`,
);
console.log(
  `Raw logs: ${parsed.records.reduce((sum, record) => sum + record.rawLogs.length, 0)}`,
);

for (const record of parsed.records) {
  console.log(
    `${record.dateKey}: ${record.habits.length} habits, ${record.rawLogs.length} raw logs`,
  );
}

if (dryRun) {
  console.log("Dry run only. Nothing was written.");
  process.exit(0);
}

const firebaseConfig = {
  apiKey: env("NEXT_PUBLIC_FIREBASE_API_KEY"),
  projectId: env("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
};
const proxy = proxyArg?.slice("--proxy=".length) || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

const authPayload = await requestJson({
  url: `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(
    firebaseConfig.apiKey,
  )}`,
  method: "POST",
  body: { returnSecureToken: true },
  proxy,
});
const idToken = authPayload.idToken;

if (!idToken) {
  throw new Error("Firebase Auth did not return an ID token.");
}

for (const record of parsed.records) {
  const documentName = [
    "projects",
    firebaseConfig.projectId,
    "databases/(default)/documents/artifacts",
    APP_ID,
    "users",
    targetUid,
    "dailyRecords",
    record.dateKey,
  ].join("/");

  const write = {
    update: {
      name: documentName,
      fields: toFirestoreFields({
        habits: record.habits,
        rawLogs: record.rawLogs,
      }),
    },
    ...(merge ? { updateMask: { fieldPaths: ["habits", "rawLogs"] } } : {}),
  };

  await requestJson({
    url: `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseConfig.projectId,
    )}/databases/(default)/documents:commit`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    body: { writes: [write] },
    proxy,
  });
}

console.log(`Imported ${parsed.records.length} daily records.`);

function parseBackup(markdown) {
  const uid = markdown.match(/同步 ID \(UID\)：(\S+)/)?.[1]?.trim() ?? "";
  const headingPattern = /^##\s+.*?(\d{4}-\d{2}-\d{2}).*$/gm;
  const headings = [...markdown.matchAll(headingPattern)];

  const records = headings.map((heading, index) => {
    const dateKey = heading[1];
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);

    return {
      dateKey,
      habits: parseHabits(section, dateKey),
      rawLogs: parseRawLogs(section, dateKey),
    };
  });

  return { uid, records };
}

function parseHabits(section, dateKey) {
  const habitsSection = section.match(/###\s+💡[\s\S]*?(?=###\s+📝|---|$)/)?.[0] ?? "";
  const habits = [];
  const habitPattern = /^-\s+(?:🟢|🔴)\s+\[(正向|消耗)\]\s+(.+)$/gm;

  for (const match of habitsSection.matchAll(habitPattern)) {
    const label = match[1];
    const habit = cleanText(match[2]);

    if (!habit) {
      continue;
    }

    habits.push({
      id: `backup-${dateKey}-habit-${habits.length + 1}`,
      habit,
      type: label === "正向" ? "good" : "bad",
      createdAt: `${dateKey}T00:00:00.000+08:00`,
    });
  }

  return habits;
}

function parseRawLogs(section, dateKey) {
  const rawSection = section.match(/###\s+📝[\s\S]*?(?=\n---|\n##\s+|$)/)?.[0] ?? "";
  const logs = [];
  const logPattern = /^-\s+\*\*\[(\d{2}:\d{2})\]\*\*\s+([\s\S]*?)(?=\n-\s+\*\*\[\d{2}:\d{2}\]\*\*|\n---|\n##\s+|$)/gm;

  for (const match of rawSection.matchAll(logPattern)) {
    const time = match[1];
    const text = cleanText(match[2]);

    if (!text) {
      continue;
    }

    logs.push({
      id: `backup-${dateKey}-log-${logs.length + 1}`,
      time,
      text,
      createdAt: `${dateKey}T${time}:00.000+08:00`,
    });
  }

  return logs;
}

function cleanText(input) {
  return input
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[“”]/g, '"')
    .trim();
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    process.env[key] ||= value;
  }
}

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function toFirestoreFields(input) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, toFirestoreValue(value)]),
  );
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }

  if (typeof value === "object") {
    return { mapValue: { fields: toFirestoreFields(value) } };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }

  return { stringValue: String(value) };
}

async function requestJson({ url, method, headers = {}, body, proxy }) {
  const response = await requestText({ url, method, headers, body, proxy });
  let payload = {};

  try {
    payload = response.text ? JSON.parse(response.text) : {};
  } catch (error) {
    throw new Error(
      `${method} ${url} returned invalid JSON: ${response.text.slice(0, 160)}${
        error instanceof Error ? ` (${error.message})` : ""
      }`,
    );
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = payload?.error?.message || response.text || `HTTP ${response.statusCode}`;
    throw new Error(`${method} ${url} failed: ${message}`);
  }

  return payload;
}

function requestText({ url, method, headers = {}, body, proxy }) {
  const target = new URL(url);
  const payload = body ? JSON.stringify(body) : undefined;
  const requestHeaders = {
    Accept: "application/json",
    ...headers,
    ...(payload
      ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        }
      : {}),
  };

  return new Promise((resolve, reject) => {
    const onResponse = (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode ?? 0, text });
      });
    };

    const onError = (error) => {
      reject(
        new Error(
          `${method} ${target.hostname} failed: ${formatRequestError(error)}${
            proxy ? ` (proxy: ${proxy})` : ""
          }`,
        ),
      );
    };

    if (proxy) {
      requestViaHttpProxy({
        target,
        method,
        headers: requestHeaders,
        payload,
        proxy,
        resolve,
        onError,
      });
      return;
    }

    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers: requestHeaders,
      },
      onResponse,
    );

    request.setTimeout(30000, () => request.destroy(new Error("request timeout")));
    request.on("error", onError);
    request.end(payload);
  });
}

function requestViaHttpProxy({ target, method, headers, payload, proxy, resolve, onError }) {
  const proxyUrl = new URL(proxy);
  if (proxyUrl.protocol !== "http:") {
    throw new Error("Only http:// proxies are supported by --proxy.");
  }

  const connectHeaders = {};
  if (proxyUrl.username || proxyUrl.password) {
    connectHeaders["Proxy-Authorization"] = `Basic ${Buffer.from(
      `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`,
    ).toString("base64")}`;
  }

  const connect = http.request({
    hostname: proxyUrl.hostname,
    port: proxyUrl.port || 80,
    method: "CONNECT",
    path: `${target.hostname}:${target.port || 443}`,
    headers: connectHeaders,
  });

  connect.setTimeout(30000, () => connect.destroy(new Error("proxy connect timeout")));
  connect.on("connect", (response, socket) => {
    if (response.statusCode !== 200) {
      socket.destroy();
      onError(new Error(`proxy CONNECT failed with HTTP ${response.statusCode}`));
      return;
    }

    const tlsSocket = tls.connect({
      socket,
      servername: target.hostname,
    });

    let timeoutId = setTimeout(() => {
      tlsSocket.destroy(new Error("request timeout"));
    }, 30000);
    const chunks = [];

    tlsSocket.on("secureConnect", () => {
      const requestHeaders = {
        Host: target.host,
        Connection: "close",
        ...headers,
      };
      const headerText = Object.entries(requestHeaders)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n");
      tlsSocket.write(
        `${method} ${target.pathname}${target.search} HTTP/1.1\r\n${headerText}\r\n\r\n${
          payload ?? ""
        }`,
      );
    });

    tlsSocket.on("data", (chunk) => {
      chunks.push(chunk);
    });

    tlsSocket.on("end", () => {
      clearTimeout(timeoutId);
      const rawBuffer = Buffer.concat(chunks);
      const raw = rawBuffer.toString("utf8");
      const separator = raw.indexOf("\r\n\r\n");
      const headerText = separator >= 0 ? raw.slice(0, separator) : raw;
      const bodyBuffer = separator >= 0 ? rawBuffer.subarray(Buffer.byteLength(raw.slice(0, separator + 4))) : Buffer.alloc(0);
      const statusCode = Number(headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] ?? 0);
      const responseHeaders = parseHttpHeaders(headerText);
      const text =
        responseHeaders["transfer-encoding"]?.toLowerCase().includes("chunked")
          ? decodeChunkedBody(bodyBuffer).toString("utf8")
          : bodyBuffer.toString("utf8");
      resolve({ statusCode, text });
    });

    tlsSocket.on("error", (error) => {
      clearTimeout(timeoutId);
      onError(error);
    });
  });
  connect.on("error", onError);
  connect.end();
}

function formatRequestError(error) {
  const parts = [
    error?.code,
    error?.name,
    error?.message,
    error?.cause?.code,
    error?.cause?.message,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" - ") : String(error);
}

function parseHttpHeaders(headerText) {
  const headers = {};

  for (const line of headerText.split("\r\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }

    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }

  return headers;
}

function decodeChunkedBody(buffer) {
  const chunks = [];
  let offset = 0;

  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset, "utf8");
    if (lineEnd < 0) {
      break;
    }

    const sizeText = buffer.toString("ascii", offset, lineEnd).split(";", 1)[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) {
      throw new Error(`Invalid chunk size: ${sizeText}`);
    }

    offset = lineEnd + 2;
    if (size === 0) {
      break;
    }

    chunks.push(buffer.subarray(offset, offset + size));
    offset += size + 2;
  }

  return Buffer.concat(chunks);
}
