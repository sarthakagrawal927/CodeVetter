import { useState, useEffect } from "react";
import { pickDirectory } from "@/lib/tauri-ipc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Create Workspace Modal ─────────────────────────────────────────────────

export default function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    repoPath: string,
    branch: string,
    prNumber?: number
  ) => void;
}) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [branch, setBranch] = useState("");
  const [prNumber, setPrNumber] = useState("");

  useEffect(() => {
    if (name.trim()) {
      setBranch(`workspace/${slugify(name)}`);
    }
  }, [name]);

  const inputClass =
    "rounded-lg border-[#1a1a1a] bg-[#0f1117] text-[13px] text-slate-200 placeholder-slate-600 focus-visible:ring-amber-500/50";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md bg-[#0a0a0a] border-[#1a1a1a] p-5">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-sm font-semibold text-slate-200">
            New Workspace
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Add workspace system"
              className={inputClass}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Project Directory
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/path/to/project"
                className={`flex-1 ${inputClass}`}
              />
              <Button
                variant="outline"
                onClick={async () => {
                  const dir = await pickDirectory("Select project directory");
                  if (dir) setRepoPath(dir);
                }}
                className="shrink-0 border-[#1a1a1a] bg-[#0f1117] text-[12px] text-slate-400 hover:text-slate-200"
              >
                Browse
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Branch
            </label>
            <Input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="workspace/feature-name"
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              PR Number{" "}
              <span className="text-slate-600 font-normal">(optional)</span>
            </label>
            <Input
              type="number"
              value={prNumber}
              onChange={(e) => setPrNumber(e.target.value)}
              placeholder="e.g. 42"
              className={inputClass}
            />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <Button
              onClick={() => {
                if (name.trim() && repoPath.trim() && branch.trim()) {
                  onCreate(
                    name.trim(),
                    repoPath.trim(),
                    branch.trim(),
                    prNumber ? parseInt(prNumber) : undefined
                  );
                }
              }}
              disabled={!name.trim() || !repoPath.trim() || !branch.trim()}
              className="bg-amber-500 text-white hover:bg-amber-600 text-[12px] font-semibold"
            >
              Create Workspace
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-[12px] text-slate-400 hover:text-slate-200"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
