import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME, THEME_DARK } from '../config';

const ThemeContext = createContext({ theme: THEME, isDark: false, toggleTheme: () => {} });

export const ThemeProvider = ({ children }) => {
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        AsyncStorage.getItem('dark_mode').then(v => { if (v === 'true') setIsDark(true); });
    }, []);

    const toggleTheme = async () => {
        const next = !isDark;
        setIsDark(next);
        await AsyncStorage.setItem('dark_mode', next ? 'true' : 'false');
    };

    return (
        <ThemeContext.Provider value={{ theme: isDark ? THEME_DARK : THEME, isDark, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
