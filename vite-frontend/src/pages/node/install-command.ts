import { writeClipboard } from "@/utils/clipboard";

export const tryCopyInstallCommand = (command: string): Promise<boolean> =>
  writeClipboard(command);
