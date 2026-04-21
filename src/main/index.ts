async function bootstrap(): Promise<void> {
  if (process.argv.includes('--baton-session-host')) {
    const { runSessionHost } = await import('./session-host-process')
    await runSessionHost()
    return
  }

  const { runElectronMain } = await import('./electron-main')
  await runElectronMain()
}

void bootstrap().catch((error) => {
  console.error(error)
  process.exit(1)
})
