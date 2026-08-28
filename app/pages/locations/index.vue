<script setup lang="ts">
const { user } = useUserSession()
await navigateTo(user.value?.role === 'ADMIN' ? '/admin/locations' : '/more/locations', { replace: true })
</script>
