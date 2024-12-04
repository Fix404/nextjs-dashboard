import { sql } from '@vercel/postgres';
import { supabase } from './supabaseClient';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue
} from './definitions';
import { formatCurrency } from './utils';


export async function fetchRevenue() : Promise<Revenue[]>{
  try {
    // Artificially delay a response for demo purposes.
    // Don't do this in production :)

    // console.log('Fetching revenue data...');
    //  await new Promise<Revenue>((resolve) => setTimeout(resolve, 3000));

    const {data, error} = await supabase.from("revenue").select("month, revenue");

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("No se encontraron datos en la tabla 'revenue'.");
    }
    
    return data;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchLatestInvoices() {
  try {
    // Consulta manual para obtener datos de ambas tablas
    const { data, error } = await supabase
      .from('invoices')
      .select(`
        amount, 
        id,
        customer_id, 
        date
      `)
      .order('date', { ascending: false })
      .limit(5);

    if (error) {
      throw new Error('Supabase query failed: ' + error.message);
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Obtener los datos de los clientes relacionados manualmente
    const customerIds = data.map((invoice) => invoice.customer_id);
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email, image_url')
      .in('id', customerIds);

    if (customerError) {
      throw new Error('Failed to fetch customers: ' + customerError.message);
    }

    // Combinar las facturas con los datos de los clientes
    const latestInvoices = data.map((invoice) => {
      const customer = customers.find((c) => c.id === invoice.customer_id);
      return {
        id: invoice.id,
        amount: formatCurrency(invoice.amount),
        name: customer?.name,
        email: customer?.email,
        image_url: customer?.image_url,
      };
    });

    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  }
}

export async function fetchCardData() {
  try {
    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.
    const { data: invoiceData, error: invoiceError }=await supabase.from('invoices').select('*');
    const { data: customerCountData, error: customerError }=await supabase.from('customers').select('*');
    const { data: invoiceStatusData, error: invoiceStatusError } = await supabase
  .from('invoices')
  .select('status, amount');

    if (invoiceError) throw new Error(`Error fetching invoices: ${invoiceError.message}`);
    if (customerError) throw new Error(`Error fetching customers: ${customerError.message}`);
    if (invoiceStatusError) throw new Error(`Error fetching invoice statuses: ${invoiceStatusError.message}`);


    const numberOfInvoices=invoiceData ? invoiceData.length : 0;
    const numberOfCustomers=customerCountData ? customerCountData.length : 0;
    const totalPaidInvoices = formatCurrency(
      invoiceData?.filter((invoice) => invoice.status === 'paid').reduce((sum, curr) => sum + curr.amount, 0) ?? 0
    );
    const totalPendingInvoices = formatCurrency(
      invoiceData?.filter((invoice) => invoice.status === 'pending').reduce((sum, curr) => sum + curr.amount, 0) ?? 0
    );

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    // Construye la consulta OR para filtrar por múltiples campos.
    const filterCondition = query
  ? `(
      customers.name.ilike.%${query}%,
      customers.email.ilike.%${query}%,
      amount::text.ilike.%${query}%,
      date::text.ilike.%${query}%,
      status.ilike.%${query}%
    )`
  : null;

    // Construye la consulta a Supabase
    const baseQuery = supabase
      .from('invoices')
      .select(`
        id,
        amount,
        date,
        status,
        customers (
          name,
          email,
          image_url
        )
      `)
      .order('date', { ascending: false })
      .range(offset, offset + ITEMS_PER_PAGE - 1);

    // Aplica el filtro si existe un query
    if (filterCondition) {
      baseQuery.or(filterCondition);
    }

    const { data, error } = await baseQuery;

    if (error) {
      console.error('Supabase Error:', error);
      throw new Error('Failed to fetch invoices.');
    }

    console.log('Fetched Invoices:', data);
    return data;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    const count = await sql`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(Number(count.rows[0].count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

export async function fetchInvoiceById(id: string) {
  try {
    const data = await sql<InvoiceForm>`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `;

    const invoice = data.rows.map((invoice) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[0];
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  try {
    const data = await sql<CustomerField>`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `;

    const customers = data.rows;
    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch all customers.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    const data = await sql<CustomersTableType>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const customers = data.rows.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  }
}
