import { StorageService } from './StorageService'
import {
  printColumnBench,
  printPageSizeBench,
  printWriteBench,
} from '@/lib/storage/columnBenchReport'
import { mergeForSync } from '@/lib/cloudSync/merge'
import { diffTransactions } from '@/lib/storage/transactionDiff'
import {
  assemblePeerDataFile,
  buildManifest,
  decodePartition,
  encodePartition,
  partitionFileName,
  planFetch,
  planPublish,
  verifyPartition,
} from '@/lib/cloudSync/partitions'

export const storage = new StorageService()

// Expose the storage singleton on window in dev mode so Playwright E2E tests
// can call `window.__storage.replaceAll(data)` to seed SQLite before each test.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__storage = storage
  // CS-30: exposes the pure sync merge/diff functions (already bundled regardless — both are
  // used by syncService.ts/folderSyncService.ts/useDataStore.ts in production, so this adds no
  // new code to the prod bundle, only this assignment, which DEV-gating strips same as
  // __storage above) so e2e specs can build a realistic merged DataFile + delta exactly the way
  // the real sync write-path does, instead of duplicating that logic in the spec file.
  // CS-41: mesma justificativa — `partitions.ts` inteiro já é bundlado pelo transporte de sync em
  // produção, então isto acrescenta só as atribuições, que o gate DEV remove. Os specs precisam
  // delas para exercitar publicação/consumo de partição contra o wa-sqlite real, que é o único
  // lugar onde os leitores do worker e a normalização de hash do CS-32 podem ser verificados.
  ;(window as unknown as Record<string, unknown>).__syncTest = {
    mergeForSync,
    diffTransactions,
    partitions: {
      assemblePeerDataFile,
      buildManifest,
      decodePartition,
      encodePartition,
      partitionFileName,
      planFetch,
      planPublish,
      verifyPartition,
    },
  }
}

// HY/Fase 0 — ferramenta de medição, **fora** do gate `import.meta.env.DEV` de propósito.
//
// O `M-87` e o `M-91` documentam que medir boot em `npm run dev` leva à conclusão errada, e um
// build de produção não tem nada que esteja atrás daquele gate. Ou este gancho sobrevive ao build,
// ou a medição não segue o ritual que o próprio projeto estabeleceu. Mesma exceção reconhecida do
// `lib/cloudSync/syncMetrics.ts`, e pelo mesmo motivo: o número que interessa só existe no
// dispositivo e no cofre reais — inclusive no celular, onde o boot dói mais e onde nenhum gancho
// de desenvolvimento chega.
//
// O custo em produção é a leitura de `location.search` no carregamento e um `if` que não entra;
// `benchColumns()` só é referenciado dentro dele.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('bench')) {
  ;(window as unknown as Record<string, unknown>).__bench = {
    columns: (rounds?: number) => storage.benchColumns(rounds).then(printColumnBench),
    pages: () => storage.benchPageSize().then(printPageSizeBench),
    writes: (rounds?: number) => storage.benchWrite(rounds).then(printWriteBench),
  }
  // eslint-disable-next-line no-console -- é a saída da ferramenta, não depuração
  console.info(
    '[gimbo] benchmark pronto — `__bench.columns()`, `__bench.pages()` ou `__bench.writes()`'
  )
}
