import { X } from "lucide-react";
import { CodeEditor } from "@/code/code-editor";
import { cn } from "@/lib/utils";
import { useCodeTabs, useTabsStore } from "@/store/tabs";

export function CodeEditorPanel() {
  const tabs = useCodeTabs();
  const activeId = useTabsStore((s) => s.activeCodeId);
  const selectTab = useTabsStore((s) => s.selectTab);
  const closeTab = useTabsStore((s) => s.closeTab);

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        <p className="text-sm">Open a .ts node file to edit it here.</p>
      </div>
    );
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  function handleClose(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.dirty) {
      const confirmed = window.confirm(
        `"${tab.title}" has unsaved changes. Close without saving?`,
      );
      if (!confirmed) return;
    }
    closeTab(tabId);
  }

  return (
    <div className="flex h-full flex-col">
      {/* tab strip same shape as Workflow panel */}
      <div className="flex shrink-0 items-center gap-px overflow-x-auto border-b border-border bg-muted/30">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                handleClose(tab.id);
              }
            }}
            className={cn(
              "group flex shrink-0 items-center gap-2 border-r border-border bg-muted px-3 py-1.5 text-sm",
              tab.id !== activeId && "bg-background",
            )}
          >
            <button
              type="button"
              onClick={() => selectTab(tab.id)}
              className={cn(
                "min-w-0 truncate",
                tab.id === activeId
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.title}
              {tab.dirty && (
                <span className="ml-1 text-muted-foreground">&bull;</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleClose(tab.id)}
              className="rounded-sm p-0.5 text-muted-foreground opacity-60 hover:bg-accent hover:opacity-100"
              aria-label={`Close ${tab.title}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {active?.path ? (
          <CodeEditor path={active.path} tabId={active.id} />
        ) : active ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <h2 className="text-xl font-semibold">{active.title}</h2>
            <p className="text-sm text-muted-foreground">
              This tab has no file path. Re-open it from the file tree.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
