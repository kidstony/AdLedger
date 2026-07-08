// Parse cờ CLI tối giản: --network=x, --account=y, --dry-run
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { network: null, account: null, dryRun: false, _unknown: [] }
  for (const arg of argv) {
    if (arg.startsWith('--network=')) {
      args.network = arg.slice('--network='.length)
    } else if (arg.startsWith('--account=')) {
      args.account = arg.slice('--account='.length)
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else {
      args._unknown.push(arg)
    }
  }
  return args
}
