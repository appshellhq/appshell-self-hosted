import './orders.css';

const ORDERS = [
  { id: 'A-1042', customer: 'Northwind Traders', total: 1280.0, status: 'Shipped' },
  { id: 'A-1041', customer: 'Contoso Ltd', total: 412.5, status: 'Packing' },
  { id: 'A-1040', customer: 'Fabrikam Inc', total: 98.99, status: 'Shipped' },
  { id: 'A-1039', customer: 'Tailspin Toys', total: 2310.0, status: 'Awaiting payment' },
];

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** A sample page: another team's package, mounted by the layout at the route it publishes. */
export default function Orders() {
  return (
    <section className="orders">
      <h1>Recent orders</h1>
      <table>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Customer</th>
            <th scope="col" className="number">
              Total
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {ORDERS.map(({ id, customer, total, status }) => (
            <tr key={id}>
              <td>{id}</td>
              <td>{customer}</td>
              <td className="number">{money.format(total)}</td>
              <td>{status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
