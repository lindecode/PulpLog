// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import { filterLogs } from "./logProcessing.mjs";
self.onmessage = ({ data }) => {
  try { self.postMessage({ result:filterLogs(...data) }); }
  catch { self.postMessage({ error:true }); }
};
