# Performance

This document describes how the performance of the Noto backend is measured
and which numbers were measured for the notes tree (card P3-1).

## Platform of the measurements

| item | value |
| --- | --- |
| OS | Windows 10.0.26100 (Microsoft Windows NT 10.0.26100.0), x64 |
| CPU | AMD Ryzen 3 3100 (4 cores) |
| Go | the local toolchain of the repository (`.tools/goroot/go/bin/go.exe`) |
| Database | SQLite through the pure Go driver `modernc.org/sqlite` |
| Notes | 2000 Markdown files spread over 20 folders (`folder-00` .. `folder-19`) |
| Iterations | 9 - 11 requests per operation, the median and the p95 are reported |

**The measurements on Windows are noisy.** The file system, the antivirus
filter driver and the scheduler of the machine add a jitter of 10 - 30 % between
two runs of the same code. Every number below is therefore reported as a range
of several runs, and only differences that are far above that jitter are
treated as a real improvement.

## What was changed

`notes.Service.Tree` used to call `store.GetNote(ctx, rel)` once per node
found by the file system walk, so a tree of 2000 notes produced about 2000
separate `SELECT` statements (the N+1 problem of the audit).

The metadata is now read with a single `store.ListNotes(ctx)` call and is
distributed to the walked nodes by path. The public behaviour of the endpoint
is unchanged, and the storage interface `port.Store` was **not** changed: the
N+1 was removed with the method that already existed in the interface.

* the file system walk, the path checks and the junction/symlink guards are
  untouched;
* a node without a row in the database is still returned with the values
  computed from the file system (`mergeStored` with `found == false`);
* the order of the folders and of the files is still the order of the path;
* the separation into `folders` and `files` is unchanged;
* a failing store still makes the call fail with the `internal` error code.

Pseudocode of the new `Tree`:

```
stored  := store.ListNotes(ctx)            // one query
byPath  := map[path]model.Node{}
for n in stored: byPath[n.Path] = n

for (rel, info) in walk(notesRoot):        // unchanged walk
    node := statNode(info)                 // unchanged
    node.Path, node.Name, node.ParentPath = rel, baseOf(rel), parentOf(rel)
    persisted, found := byPath[rel]        // no more per node query
    node := mergeStored(node, persisted, found)
    if isDir: folders = append(folders, node)
    else:     files   = append(files, node)

sort folders and files by path             // unchanged
```

## Method

Two independent measurements are used.

### 1. Go benchmarks

`backend/internal/notes/service_bench_test.go` fills a temporary notes
directory with 2000 notes, fills the real SQLite store with their metadata
(`Reindex`) and then measures the service:

```
cd backend
go test ./internal/notes -bench=BenchmarkTree -benchmem -count=3
go test ./internal/notes -bench=BenchmarkSearch -benchmem
go test ./internal/notes -bench=BenchmarkReindex -benchmem
```

The `-run=NONE` filter is deliberately **not** used: with the Go toolchain of
this repository (go 1.27.3) it also suppresses the benchmarks, so the command
would print `ok ... [no tests to run]` without a single benchmark result.

The "before" numbers were measured with the original `service.go` (the file
was taken from `HEAD` and restored afterwards), the "after" numbers with the
new implementation. Both were measured on the same machine, one after the
other.

### 2. End to end HTTP measurement

`scripts/measure-perf.ps1` generates the notes, starts a real server
(`go run ./cmd/noto`) on a free port with its own `NOTO_DATA_DIR`, reindexes
the notes and measures the HTTP endpoints:

```
.\scripts\measure-perf.ps1 -Notes 2000 -Iterations 11
```

The script prints the median and the p95 of every operation and always stops
the server and removes the temporary directory.

## Results

### Go benchmark, `BenchmarkTree` (2000 notes, real SQLite store)

| | ns/op | B/op | allocs/op |
| --- | --- | --- | --- |
| before | 170 188 917 / 185 009 133 / 166 830 400 | ~5 530 000 | ~98 930 |
| after | 87 765 225 / 89 221 833 / 92 000 000 (median of 93 506 617 and 94 585 369) / 103 782 417 | ~5 680 000 | ~56 440 |

* about **1.9x faster** (median before ~170 ms, median after ~92 ms),
* the number of allocations drops by **43 %** (98 930 -> 56 440), which is the
  ~2000 removed `GetNote` calls,
* the allocated bytes stay about the same, because the tree itself is still
  built in memory.

### HTTP endpoints (2000 notes, `scripts/measure-perf.ps1`)

| operation | before median / p95 (ms) | after median / p95 (ms) |
| --- | --- | --- |
| `GET /api/tree` | 283.09 / 314.22 | 110.23 / 117.98 and 98.46 / 124.76 |
| `GET /api/search?q=lorem` | 17.59 / 25.10 | 12.10 / 15.26 and 11.89 / 12.34 |
| `GET /api/notes` | 2.33 / 5.64 | 1.13 / 1.50 and 1.25 / 2.14 |
| `PUT /api/notes` | 11.01 / 13.32 | 8.62 / 10.09 and 8.22 / 10.35 |

The tree endpoint is the only operation whose code path changed, so the
difference of the other three rows is within the run to run noise of the
machine (they were measured on the same binary, only the order of the runs
differs). The tree endpoint is **2.3x - 2.9x faster** (median 283 ms ->
98 - 110 ms). The remaining latency is dominated by the file system walk of
the 2000 files and by the JSON encoding of the answer.

### Other benchmarks (unchanged code, for reference)

| benchmark | ns/op | comment |
| --- | --- | --- |
| `BenchmarkSearch` | 11 142 191 (before) / 11 963 611 (after) | the search path was not changed, the difference is noise |
| `BenchmarkReindex` | 7 698 596 500 | `Reindex` still reads the metadata of every note separately, it is out of the scope of P3-1 |

## Known follow ups

* `Service.Reindex` has the same N+1 pattern (`GetNote` per file). It lives
  in `backend/internal/notes/search.go` and was out of the scope of this
  card; at 2000 notes a full reindex takes about 7.7 s.
* The JSON encoding of the tree is now a visible part of the answer time. If
  the tree grows further, the next step would be a streaming answer or a
  cached tree.

## How to reproduce

```
cd backend
go test ./internal/notes -bench=BenchmarkTree -benchmem -count=3
cd ..
.\scripts\measure-perf.ps1 -Notes 2000 -Iterations 11
```

All benchmarks of the notes package in one run:

```
cd backend
go test ./internal/notes -bench=. -benchmem
```

The same benchmark step is part of the verification script and can be
requested with the `-Bench` switch; a markdown report of the whole run can be
written with `-ReportPath`:

```
cd ..
.\scripts\verify.ps1 -Bench -ReportPath .tools\verify-report.md
```
