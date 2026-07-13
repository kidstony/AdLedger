// Parse cờ CLI tối giản: --network=x, --account=y, --dry-run, --kind=revenue|breakdown
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { network: null, account: null, dryRun: false, kind: null, _unknown: [] }
  for (const arg of argv) {
    if (arg.startsWith('--network=')) {
      args.network = arg.slice('--network='.length)
    } else if (arg.startsWith('--account=')) {
      args.account = arg.slice('--account='.length)
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg.startsWith('--kind=')) {
      const k = arg.slice('--kind='.length)
      if (k === 'revenue' || k === 'breakdown') args.kind = k
      else args._unknown.push(arg)
    } else {
      args._unknown.push(arg)
    }
  }
  return args
}
