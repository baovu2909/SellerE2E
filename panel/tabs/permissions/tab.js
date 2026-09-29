export default {
  collect: {
    permissions(body, { $ }) {
      body.search = $('#perm-search').value.trim();
    },
  },
};
