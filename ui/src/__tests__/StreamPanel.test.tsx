import { describe, test, expect, mock, afterEach, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Set up DOM environment before any imports that need it.
// This allows this test file to run standalone (bun test ui/src/__tests__/StreamPanel.test.tsx)
// and also when discovered by the root bun test runner.
beforeAll(() => {
  if (typeof document === "undefined") {
    GlobalRegistrator.register();
  }
});

// Mock the hook before the component is imported so the component receives our stub.
// bun test hoists static imports, so we import the component via dynamic import below.
mock.module("@/hooks/useAgentStream", () => ({
  useAgentStream: (_taskId: string) => ({
    lines: ["<script>alert(1)</script>", "normal log line"],
    isLive: false,
    taskId: _taskId,
  }),
}));

const { StreamPanel } = await import("@/components/StreamPanel");
const { render, cleanup } = await import("@testing-library/react");

afterEach(cleanup);

describe("StreamPanel XSS safety", () => {
  test("renders <script> log line as literal text, not injected HTML", () => {
    const { container } = render(<StreamPanel taskId="TSK_000001" />);

    // No <script> element should appear inside the panel
    expect(container.querySelectorAll("script")).toHaveLength(0);

    // The literal text must be present (React escapes it as a text node)
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  test("renders multiple log lines", () => {
    const { container } = render(<StreamPanel taskId="TSK_000001" />);
    expect(container.textContent).toContain("normal log line");
  });

  test("uses plain text rendering — no dangerouslySetInnerHTML in output", () => {
    const { container } = render(<StreamPanel taskId="TSK_000001" />);
    // If dangerouslySetInnerHTML were used, the <script> tag would create an element.
    // Verify there's no element whose innerHTML matches the raw script string.
    const allElements = Array.from(container.querySelectorAll("*"));
    const hasRawScript = allElements.some(
      (el) => el.innerHTML === "<script>alert(1)</script>"
    );
    expect(hasRawScript).toBe(false);
  });
});
