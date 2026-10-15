export type DataMode = 'browser' | 'local';
declare const __EWS_DATA_MODE__: DataMode;

export function getDataMode(): DataMode {
  return typeof __EWS_DATA_MODE__ !== 'undefined' ? __EWS_DATA_MODE__ : 'local';
}

export const usesBrowserStorage = () => getDataMode() === 'browser';
