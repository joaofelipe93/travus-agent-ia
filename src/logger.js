import { pino } from "pino";

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

export const logger = pino({
  level,
  base: { service: "travus-agent-ia" },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service" },
        },
      }),
});

export function withContext(bindings) {
  return logger.child(bindings);
}
