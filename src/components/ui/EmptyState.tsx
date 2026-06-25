interface Props {
  message?: string
  colSpan?: number
}

export default function EmptyState({ message = 'Không có dữ liệu.', colSpan }: Props) {
  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan} className="py-10 text-center text-sm text-slate-400">
          {message}
        </td>
      </tr>
    )
  }
  return (
    <div className="border border-slate-200 rounded-lg p-12 text-center">
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  )
}
