import { test, expect } from '@playwright/test'

// HY-21 — o cofre passou a ser de aba única quando o banco começou a ser aberto com
// `locking_mode=EXCLUSIVE` (`HY-20`), que é o que mantém o `SyncAccessHandle` do OPFS aberto e o
// que torna o WAL possível nesta VFS.
//
// O risco que este spec cobre não é cosmético: **sem tratamento, a segunda aba não dá erro — ela
// trava**, esperando um lock que a primeira nunca libera. Um teste de unidade com mocks não
// provaria nada aqui, porque o que precisa ser verdade é a interação de dois contextos de execução
// reais com um arquivo real do OPFS.
//
// As duas páginas vivem no **mesmo** BrowserContext de propósito: é o que compartilha a origem e,
// portanto, o mesmo OPFS. Contextos separados teriam armazenamentos isolados e o conflito nunca
// aconteceria.

test('a segunda aba avisa em vez de travar, e "Usar aqui" transfere a posse', async ({
  context,
}) => {
  const first = await context.newPage()
  await first.goto('/')
  // A primeira aba abre normalmente: ela é a dona.
  await expect(first.getByText('O Gimbo já está aberto')).toHaveCount(0)

  const second = await context.newPage()
  await second.goto('/')

  // Sem este tratamento, a asserção abaixo estouraria por timeout com a página em branco — que é
  // exatamente o sintoma que a feature existe para eliminar.
  await expect(second.getByText('O Gimbo já está aberto')).toBeVisible({ timeout: 10000 })
  await expect(second.getByRole('button', { name: 'Usar aqui' })).toBeVisible()

  await second.getByRole('button', { name: 'Usar aqui' }).click()

  // A aba que assumiu recarrega e passa a operar normalmente.
  await expect(second.getByText('O Gimbo já está aberto')).toHaveCount(0, { timeout: 15000 })

  // E a que cedeu mostra a tela, agora com o texto de quem perdeu a posse — sem recarregar
  // sozinha e sem perder dado (tudo que ela fez já estava gravado).
  await expect(first.getByText('Outra aba assumiu o controle do seu cofre.')).toBeVisible({
    timeout: 10000,
  })
})

test('"Cancelar" mantém a aba fora do cofre, com a opção de assumir depois', async ({
  context,
}) => {
  const first = await context.newPage()
  await first.goto('/')
  const second = await context.newPage()
  await second.goto('/')

  await expect(second.getByText('O Gimbo já está aberto')).toBeVisible({ timeout: 10000 })
  await second.getByRole('button', { name: 'Cancelar' }).click()

  // Cancelar não é um beco sem saída: a tela permanece e o botão de assumir continua ali.
  await expect(second.getByText('O Gimbo já está aberto')).toBeVisible()
  await expect(second.getByRole('button', { name: 'Usar aqui' })).toBeVisible()
  await expect(second.getByRole('button', { name: 'Cancelar' })).toHaveCount(0)

  // E a primeira aba segue dona, intocada.
  await expect(first.getByText('O Gimbo já está aberto')).toHaveCount(0)
})

test('uma aba sozinha nunca vê a tela — o caso comum não regride', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('O Gimbo já está aberto')).toHaveCount(0)
  // Recarregar tem que continuar funcionando: o lock da instância anterior precisa ser liberado na
  // saída, senão a própria aba recarregada se veria bloqueada por si mesma.
  await page.reload()
  await expect(page.getByText('O Gimbo já está aberto')).toHaveCount(0)
})
