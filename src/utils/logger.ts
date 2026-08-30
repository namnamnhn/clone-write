export const logger = {
    info: (...args: any[]) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(...args);
        }
    },
    warn: (...args: any[]) => {
        if (process.env.NODE_ENV !== 'production') {
            console.warn(...args);
        }
    },
    error: (...args: any[]) => {
        // We probably always want to log errors, or maybe conditionally
        console.error(...args);
    },
    log: (...args: any[]) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(...args);
        }
    }
};
