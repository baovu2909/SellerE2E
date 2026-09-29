/** Tab Chung — nút "Mở báo cáo" (báo cáo HTML của lần chạy gần nhất) */
export default {
  init({ $, env, showTab, appendLog }) {
    $('#report').addEventListener('click', async () => {
      const url = `/report/${env()}/`;
      const ok = await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
      if (ok) window.open(url, '_blank');
      else { showTab('log'); appendLog(`\n✘ Chưa có báo cáo cho môi trường ${env()} — hãy chạy 1 lệnh trước.\n`); }
    });
  },
};
