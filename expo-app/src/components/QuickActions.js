import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { THEME } from '../config';

const ACTIONS = [
    { label: '📝 Create Ticket', payload: '/create_ticket' },
    { label: '📋 List Tickets', payload: '/list_tickets' },
    { label: '🔍 Check Status', payload: '/check_status' },
    { label: '❓ Help', payload: '/help' },
];

const QuickActions = ({ onAction, isAuthenticated }) => (
    <View style={styles.container}>
        <View style={styles.row}>
            {ACTIONS.map((action, idx) => (
                <TouchableOpacity
                    key={idx}
                    style={styles.chip}
                    onPress={() => onAction(action.payload)}
                    activeOpacity={0.7}
                >
                    <Text style={styles.chipText}>{action.label}</Text>
                </TouchableOpacity>
            ))}
            {isAuthenticated && (
                <TouchableOpacity
                    style={[styles.chip, styles.humanChip]}
                    onPress={() => onAction('/request_human_agent')}
                    activeOpacity={0.7}
                >
                    <Text style={[styles.chipText, styles.humanChipText]}>👤 Talk to Human</Text>
                </TouchableOpacity>
            )}
        </View>
    </View>
);

const styles = StyleSheet.create({
    container: {
        backgroundColor: THEME.background,
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 4,
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: THEME.secondary,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: THEME.primary + '30',
    },
    chipText: {
        fontSize: 12,
        color: THEME.primary,
        fontWeight: '500',
    },
    humanChip: {
        backgroundColor: '#f0fdf4',
        borderColor: '#16a34a40',
    },
    humanChipText: {
        color: '#16a34a',
    },
});

export default QuickActions;
