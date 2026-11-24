# Python/onnxruntime sanity on the real models using an independent (PIL) torchreid-style preprocess.
# usage: python sanity.py <models_dir> [js_embeddings.json]   (needs onnxruntime numpy pillow)
# Checks: dim 512, batch==single, same-person (shifted/flipped) << different-person on bus.jpg boxes (boxes.json),
# and, if given, cosDist between these PIL embeddings and the JS ones from reid.js (preprocess equivalence).
import sys, os, json, gzip, numpy as np, onnxruntime as ort
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); models = sys.argv[1]
im = Image.frombytes('RGB', (810, 1080), gzip.open(os.path.join(here, 'bus.rgb.gz')).read())
boxes = json.load(open(os.path.join(here, 'boxes.json')))
mean = np.array([0.485, 0.456, 0.406], np.float32)[:, None, None]; std = np.array([0.229, 0.224, 0.225], np.float32)[:, None, None]
def prep(img, b):
    W, H = img.size; w, h = b[2] - b[0], b[3] - b[1]
    l, t, r, bt = max(0, (b[0] - .03 * w) * W), max(0, (b[1] - .03 * h) * H), min(W, (b[2] + .03 * w) * W), min(H, (b[3] + .03 * h) * H)
    c = img.resize((128, 256), Image.BILINEAR, box=(l, t, r, bt))
    return (np.asarray(c, np.float32).transpose(2, 0, 1) / 255 - mean) / std
def emb(s, xs): e = s.run(None, {'input': np.stack(xs)})[0]; return e / np.linalg.norm(e, axis=1, keepdims=True)
cd = lambda a, b: 1 - a @ b.T
js = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}
flip = im.transpose(Image.FLIP_LEFT_RIGHT)
for m, f in (('ain', 'osnet_ain_x1_0.onnx'), ('x025', 'osnet_x0_25.onnx')):
    s = ort.InferenceSession(os.path.join(models, f), providers=['CPUExecutionProvider'])
    A = emb(s, [prep(im, b) for b in boxes])
    sh = [[ (b[0]+b[2])/2+.025*(b[2]-b[0]) + k*.53*(b[2]-b[0]) for k in (-1, 1)] + [(b[1]+b[3])/2-.025*(b[3]-b[1]) + k*.53*(b[3]-b[1]) for k in (-1, 1)] for b in boxes]
    B = emb(s, [prep(im, [x0, y0, x1, y1]) for x0, x1, y0, y1 in sh])
    C = emb(s, [prep(flip, [1 - b[2], b[1], 1 - b[0], b[3]]) for b in boxes])
    one = np.concatenate([emb(s, [prep(im, b)]) for b in boxes])
    print(m, 'dim', A.shape[1], 'batch-vs-single max cosDist', float(np.abs(cd(A, one).diagonal()).max()))
    same = np.r_[cd(A, B).diagonal(), cd(A, C).diagonal()]; n = len(boxes)
    diff = np.r_[[cd(A, B)[i, j] for i in range(n) for j in range(n) if i != j], [cd(A, C)[i, j] for i in range(n) for j in range(n) if i != j], [cd(A, A)[i, j] for i in range(n) for j in range(i + 1, n)]]
    print(m, 'same-person max %.3f   different-person min %.3f' % (same.max(), diff.min())); assert same.max() < diff.min() / 2
    print(m, 'distance matrix (orig vs orig):\n', np.round(cd(A, A), 3))
    if m in js: print(m, 'PIL-vs-reid.js embedding cosDist per person:', [round(float(1 - A[i] @ np.array(js[m][i])), 5) for i in range(n)])
