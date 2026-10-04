import type { FastifyPluginAsync } from "fastify";
import {
  CoreControlService,
  CoreError,
  object,
} from "./core-control.service.js";
import { isAgentBackendUrl } from "@neko-master/shared";
export const coreControlController: FastifyPluginAsync = async (app) => {
  const service = new CoreControlService();
  app.addHook("onClose", async () => service.close());
  const backend = (raw: string) => {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1)
      throw new CoreError(400, "Invalid backend");
    const b = app.db.getBackend(id);
    if (!b) throw new CoreError(404, "Backend not found");
    if (b.type !== "clash" || isAgentBackendUrl(b.url))
      throw new CoreError(501, "Mihomo controller is required");
    if (app.authService.isShowcaseMode()) throw new CoreError(403, "Forbidden");
    return b;
  };
  app.get<{ Params: { backendId: string; resource: string } }>(
    "/:backendId/:resource",
    async (req, reply) => {
      try {
        return await service.resource(
          backend(req.params.backendId),
          req.params.resource,
        );
      } catch (e) {
        return reply
          .code(e instanceof CoreError ? e.status : 502)
          .send({
            error: e instanceof CoreError ? e.message : "Core unavailable",
          });
      }
    },
  );
  app.post<{ Params: { backendId: string } }>(
    "/:backendId/actions",
    async (req, reply) => {
      try {
        return {
          result: await service.action(
            backend(req.params.backendId),
            object(req.body),
          ),
        };
      } catch (e) {
        return reply
          .code(e instanceof CoreError ? e.status : 502)
          .send({
            error: e instanceof CoreError ? e.message : "Control action failed",
          });
      }
    },
  );
};
