import { runtime } from '@deltachat-desktop/runtime-interface'

export async function readLocalFileBuffer(
  filePath: string
): Promise<Uint8Array> {
  return runtime.readLocalFileBuffer(filePath)
}
