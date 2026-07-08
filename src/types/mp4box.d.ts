declare module "mp4box" {
  export class DataStream {
    static BIG_ENDIAN: number;
    dynamicSize: number;
    buffer: ArrayBuffer;
    constructor(arrayBuffer?: ArrayBuffer | DataView<ArrayBuffer> | number, byteOffset?: number, endianness?: number);
    getPosition(): number;
  }

  export function createFile(): {
    onError?: (module: string, message: string) => void;
    onReady?: (info: unknown) => void;
    onSamples?: (id: number, user: unknown, samples: unknown[]) => void;
    appendBuffer(buffer: ArrayBuffer & { fileStart?: number }): void;
    flush(): void;
    setExtractionOptions(id: number, user?: unknown, options?: { nbSamples?: number }): void;
    start(): void;
  };
}
