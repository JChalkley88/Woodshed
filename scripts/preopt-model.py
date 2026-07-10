# Daylight follow-up 1: save an offline-optimised copy of the fp16 htdemucs
# model so the browser can skip in-session graph optimisation (whose peak
# memory exceeds the WASM heap). Basic level first; extended only if basic
# succeeds. Usage: python scripts/preopt-model.py [basic|extended] [out]
import sys
import time

import onnxruntime as ort

level = sys.argv[1] if len(sys.argv) > 1 else "basic"
out = sys.argv[2] if len(sys.argv) > 2 else "models/htdemucs_fp16_preopt.onnx"

so = ort.SessionOptions()
so.graph_optimization_level = {
    "basic": ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
    "extended": ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED,
}[level]
so.optimized_model_filepath = out

t0 = time.time()
ort.InferenceSession(
    "models/htdemucs_fp16weights.onnx", so, providers=["CPUExecutionProvider"]
)
print(f"{level}: wrote {out} in {time.time() - t0:.1f}s")
