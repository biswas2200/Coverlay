package com.resumeanalyser.admin;

import com.resumeanalyser.account.User;
import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.account.UserRole;
import com.resumeanalyser.account.dto.UserDto;
import com.resumeanalyser.common.ConflictException;
import com.resumeanalyser.common.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

/**
 * Account administration: find an account by email and change its access
 * level (USER / ADMIN) by hand.
 */
@Service
public class AdminService {

    private final UserRepository userRepository;

    public AdminService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /** Looks an account up by its login email, for the admin UI's "find user" step. */
    public UserDto findByEmail(String email) {
        return userRepository.findByEmail(email)
                .map(this::toDto)
                .orElseThrow(() -> new ResourceNotFoundException("No user with email " + email));
    }

    /**
     * Sets an account's access level. An administrator cannot change their
     * own: that way a stolen or mistaken session cannot quietly drop the last
     * administrator, and there is always another admin who made the change.
     *
     * @param actingEmail the signed-in administrator making the change
     * @throws ResourceNotFoundException if no account has that id
     * @throws ConflictException         if the account is the administrator's own
     */
    @Transactional
    public UserDto updateRole(String actingEmail, UUID userId, UserRole role) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("No user with id " + userId));
        if (user.getEmail().equalsIgnoreCase(actingEmail)) {
            throw new ConflictException("You cannot change your own access level; ask another administrator");
        }
        user.setRole(role);
        return toDto(userRepository.save(user));
    }

    private UserDto toDto(User user) {
        return new UserDto(user.getId(), user.getEmail(), user.getRole(), user.getCreatedAt());
    }
}
