import { loadWorkflowConfig, saveWorkflowConfig, type WorkflowConfig } from "../../fsm/workflow-config.js";
import { json, badRequest, err } from "../response.js";

export function fsmWorkflowRoute(
  path: string,
  req: Request
): Response | Promise<Response> | null {
  if (req.method === "GET" && path === "/api/fsm/workflow") {
    return json(loadWorkflowConfig());
  }

  if (req.method === "PUT" && path === "/api/fsm/workflow") {
    return (req.json() as Promise<unknown>).then((body) => {
      try {
        const config = body as WorkflowConfig;
        if (!Array.isArray(config?.transitions))
          return badRequest("transitions must be an array");
        if (!Array.isArray(config?.hitlGatedTriggers))
          return badRequest("hitlGatedTriggers must be an array");
        if (config.mode !== undefined && config.mode !== "changeset" && config.mode !== "gsd")
          return badRequest("mode must be 'changeset' or 'gsd'");
        saveWorkflowConfig(config);
        return json({ ok: true });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }) as unknown as Promise<Response>;
  }

  return null;
}
