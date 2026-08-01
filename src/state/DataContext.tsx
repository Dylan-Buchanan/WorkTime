import { createContext, useContext } from "react";
import type { DataAccess } from "../lib/data/DataAccess";

const DataContext = createContext<DataAccess | undefined>(undefined);

export function DataProvider({ dataAccess, children }: { dataAccess: DataAccess; children: React.ReactNode }) {
    return <DataContext.Provider value={dataAccess}>{children}</DataContext.Provider>;
}

export function useData(): DataAccess {
    const data = useContext(DataContext);
    if (!data) throw new Error("useData must be inside DataProvider");
    return data;
}
