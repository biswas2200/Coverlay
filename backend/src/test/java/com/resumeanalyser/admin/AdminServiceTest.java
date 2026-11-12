package com.resumeanalyser.admin;

import com.resumeanalyser.account.User;
import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.account.UserRole;
import com.resumeanalyser.common.ConflictException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminServiceTest {

    @Mock
    private UserRepository userRepository;

    private final UUID id = UUID.randomUUID();

    private User account(String email, UserRole role) {
        User user = new User();
        user.setId(id);
        user.setEmail(email);
        user.setRole(role);
        return user;
    }

    @Test
    void anAdministratorChangesAnotherAccountsRole() {
        User target = account("someone@example.com", UserRole.USER);
        when(userRepository.findById(id)).thenReturn(Optional.of(target));
        when(userRepository.save(target)).thenReturn(target);

        var dto = new AdminService(userRepository).updateRole("owner@example.com", id, UserRole.ADMIN);

        assertThat(dto.role()).isEqualTo(UserRole.ADMIN);
        assertThat(dto.adminPath()).isNull();
    }

    @Test
    void anAdministratorCannotChangeTheirOwnRole() {
        User self = account("owner@example.com", UserRole.ADMIN);
        when(userRepository.findById(id)).thenReturn(Optional.of(self));

        assertThatThrownBy(() -> new AdminService(userRepository).updateRole("Owner@Example.com", id, UserRole.USER))
                .isInstanceOf(ConflictException.class);
        assertThat(self.getRole()).isEqualTo(UserRole.ADMIN);
        verify(userRepository, never()).save(any());
    }
}
