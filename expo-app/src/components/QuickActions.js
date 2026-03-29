import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { THEME } from '../config';

const ACTIONS = [
    { label: '📝 Create Ticket', payload: '/create_ticket' },
    { label: '📋 List Tickets', payload: '/list_tickets' },
    { label: '🔍 Check Status', payload: '/check_status' },
    { label: '❓ Help', payload: '/help' },
];

const QuickActions = ({ onAction }) => (
    <View style={styles.container}>
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
        >
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
        </ScrollView>
    </View>
);

const styles = StyleSheet.create({
    container: {
        backgroundColor: THEME.background,
        borderTopWidth: 1,
        borderTopColor: THEME.border,
        paddingVertical: 10,
    },
    scrollContent: {
        paddingHorizontal: 16,
        gap: 8,
    },
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: THEME.secondary,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: THEME.primary + '20', // Very light primary border
    },
    chipText: {
        fontSize: 13,
        color: THEME.primary,
        fontWeight: '600',
    },
});

export default QuickActions;
