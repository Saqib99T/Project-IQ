import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

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
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        paddingVertical: 8,
    },
    scrollContent: {
        paddingHorizontal: 16,
        gap: 8,
    },
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: '#f3f4f6',
        borderRadius: 20,
    },
    chipText: {
        fontSize: 13,
        color: '#4b5563',
        fontWeight: '500',
    },
});

export default QuickActions;
