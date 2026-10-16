export const db = {
  orders: {
    async insert(row: { total: number }) {
      return { id: "ord_1", total: row.total };
    },
  },
};
